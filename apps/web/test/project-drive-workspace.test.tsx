// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'
import type { ProjectSession } from '../src/lib/api'
import type { ProjectTalkApi } from '../src/lib/use-project-talk'

/**
 * The project drive on the project workspace (project-level-test-drive
 * decisions 4, 7): the Test drive card on the resting page, starting a drive
 * hands the body to the drive view with the notes rail, Project page steps
 * back while the drive runs, Stop returns to rest, and a live chat shares the
 * body through a Chat | Drive switch.
 *
 * Tier 2: what is asserted is what a click does to the body — which pieces
 * are hidden and which mutation went out — none of which a static string shows.
 * The server is the true boundary: the drive query answers what the test says
 * the slot holds, and the mutation's answer moves it.
 */

type Slot = Record<string, unknown> | null
let slot: Slot = null
let project: Record<string, unknown> = {}
let notes: ProjectNote[] = []
let testDriveResult: { ok: boolean; deniedReason?: string } = { ok: true }
const testDrive = vi.fn()
const toast = vi.fn()
const addNote = vi.fn(async (input: { projectId: string; text: string }) => ({
  id: 'pnote_new',
  ...input,
}))

const LIVE: Slot = {
  state: 'serving',
  projectDrive: true,
  projectId: 'proj_1',
  holderLabel: 'a project drive of main',
  branch: 'main',
  commit: '1882e87',
  startedAt: 5_000,
  devUrl: 'about:blank',
  devReady: true,
  devConfigured: true,
  devPaneId: 'pane_1',
}

vi.mock('../src/trpc', () => {
  const invalidate = vi.fn()
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        project: { projectSession: { invalidate }, conversations: { invalidate } },
        projectNotes: { invalidate },
        feature: { driveInfo: { invalidate } },
      }),
      project: {
        list: { useQuery: () => ({ data: [project] }) },
        branches: { useQuery: () => ({ data: { current: 'main', detected: 'main', branches: [] } }) },
        testDrive: {
          useMutation: () => ({
            isPending: false,
            mutate: (
              input: { projectId: string; action: 'start' | 'stop' },
              opts: { onSuccess: (r: typeof testDriveResult) => void },
            ) => {
              testDrive(input)
              if (testDriveResult.ok) slot = input.action === 'start' ? LIVE : null
              opts.onSuccess(testDriveResult)
            },
          }),
        },
      },
      projectNotes: {
        list: { useQuery: () => ({ data: notes }) },
        add: { useMutation: () => ({ mutateAsync: addNote }) },
        edit: { useMutation: mutation },
        delete: { useMutation: mutation },
        dismiss: { useMutation: mutation },
        reopen: { useMutation: mutation },
      },
      // DrivePanel's feature-note door, mounted but unused on a project drive.
      notes: { add: { useMutation: mutation } },
      feature: {
        list: { useQuery: () => ({ data: [] }) },
        driveInfo: { useQuery: () => ({ data: slot }) },
        endSession: { useMutation: mutation },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: toast }) }))
vi.mock('../src/lib/use-session-branch', () => ({
  useSessionBranch: () => ({
    value: 'main',
    branches: ['main'],
    detected: 'main',
    missing: false,
    pick: () => {},
    picking: false,
  }),
}))
// The terminal is a websocket client; its mount is not what is under test.
vi.mock('../src/components/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/lib/project-notes', () => ({
  uploadProjectNoteScreenshot: vi.fn(),
  isNoteHotkey: () => false,
}))

const { ProjectWorkspace } = await import('../src/components/ProjectWorkspace')

const talk = (over: Partial<ProjectTalkApi> = {}): ProjectTalkApi => ({
  session: null,
  state: 'none',
  conversations: [],
  conversationsPending: false,
  start: vi.fn(),
  triage: vi.fn(),
  replace: vi.fn(),
  resume: vi.fn(),
  starting: false,
  ...over,
})

const liveChat = {
  id: 'sess_1',
  projectId: 'proj_1',
  kind: 'project',
  status: 'live',
  worktreePath: '/w',
} as ProjectSession

const note = (id: string, createdAt: number, over: Partial<ProjectNote> = {}): ProjectNote => ({
  id,
  projectId: 'proj_1',
  text: id,
  status: 'open',
  createdAt,
  updatedAt: createdAt,
  ...over,
})

beforeEach(() => {
  slot = null
  testDriveResult = { ok: true }
  project = {
    id: 'proj_1',
    name: 'journal-app',
    repoPath: '/home/you/journal-app',
    driveSetupCommand: 'bun run drive:setup',
    devCommand: 'bun run dev',
  }
  notes = [note('already reported', 1_000)]
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Is this element in a part of the body the human can see? */
const shown = (el: HTMLElement): boolean => el.closest('[hidden], .hidden') === null

/** Is the resting page — its New chat card — what fills the body? */
function restShown(): boolean {
  const card = screen.queryByText('Talk it through')
  return card !== null && shown(card)
}

function mount(api: ProjectTalkApi = talk(), props: { onOpenPreparation?: () => void } = {}) {
  const view = render(<ProjectWorkspace projectId="proj_1" talk={api} {...props} />)
  return { rerender: () => view.rerender(<ProjectWorkspace projectId="proj_1" talk={api} {...props} />) }
}

describe('the Test drive card', () => {
  it('sits under New chat and keeps the plan in a closed Drive setup disclosure', () => {
    mount()
    const card = screen.getByRole('region', { name: 'Test drive' })
    const talkHeading = screen.getByText('Talk it through')
    expect(talkHeading.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    // read once, then known: collapsed until asked for
    const setup = within(card).getByText('Drive setup').closest('details')
    expect(setup?.open).toBe(false)
    const text = setup?.textContent ?? ''
    expect(text).toContain('main')
    expect(text).toContain('your checkout, as it is — no branch switch')
    expect(text).toContain('project-drive')
    expect(text).toContain('bun run drive:setup')
    expect(text).toContain('bun run dev')
    // the unset stop command, with the way to set it
    expect(text).toContain('Nothing set')
    // secondary: New chat stays the page's one primary
    const button = within(card).getByRole('button', { name: 'Test drive' })
    expect(button.getAttribute('data-variant')).toBe('secondary')
  })

  it('opens preparation when neither a setup nor a dev command is set', () => {
    project = { ...project, driveSetupCommand: undefined, devCommand: undefined }
    const onOpenPreparation = vi.fn()
    mount(talk(), { onOpenPreparation })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare drive' }))
    expect(onOpenPreparation).toHaveBeenCalledTimes(1)
    expect(testDrive).not.toHaveBeenCalled()
  })

  it('is disabled and names the holder while another drive has the slot', () => {
    slot = { ...LIVE, projectDrive: undefined, projectId: undefined, holderLabel: 'a test drive of feature/x' }
    mount()
    const card = screen.getByRole('region', { name: 'Test drive' })
    expect((within(card).getByRole('button', { name: 'Test drive' }) as HTMLButtonElement).disabled).toBe(true)
    expect(card.textContent).toContain('A test drive of feature/x is running')
  })
})

describe('driving from the project page', () => {
  it('starts a drive and hands the body to the drive view, then stops back to rest', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
    rerender()

    // the resting page is out of the way; the drive owns the body
    expect(restShown()).toBe(false)
    const header = screen.getByRole('heading', { name: 'Driving main' })
    expect(shown(header)).toBe(true)
    expect(screen.getByText('/home/you/journal-app @ 1882e87')).toBeTruthy()
    expect(screen.getByTitle('the app on this branch')).toBeTruthy()
    expect(screen.getByText(/^dev server$/i)).toBeTruthy()
    const rail = screen.getByRole('complementary', { name: 'Notes' })
    expect(within(rail).getByText('already reported')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop drive' }))
    expect(testDrive).toHaveBeenLastCalledWith({ projectId: 'proj_1', action: 'stop' })
    rerender()
    expect(restShown()).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Driving main' })).toBeNull()
  })

  it('toasts a refusal and stays at rest', () => {
    testDriveResult = { ok: false, deniedReason: 'A test drive of feature/x is running — stop it first' }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(toast).toHaveBeenCalledWith('A test drive of feature/x is running — stop it first')
    expect(restShown()).toBe(true)
  })

  it('steps back to the project page while the drive keeps running, and returns', () => {
    slot = LIVE
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(shown(screen.getByRole('heading', { name: 'Driving main' }))).toBe(true)

    // the way back is the drive topbar's parent crumb: the project
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    rerender()
    expect(restShown()).toBe(true)
    expect(screen.getByRole('region', { name: 'Test drive' }).textContent).toContain('Running')
    expect(testDrive).not.toHaveBeenCalled()
  })

  it("lists this drive's notes first, tagged, and saves the composer's note on Enter", async () => {
    slot = LIVE
    notes = [
      note('already reported', 1_000),
      note('streak resets at UTC', 6_000, { driveBranch: 'main', driveCommit: '1882e87' }),
    ]
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    const rail = screen.getByRole('complementary', { name: 'Notes' })
    const thisDrive = within(rail).getByRole('region', { name: 'This drive' })
    const older = within(rail).getByRole('region', { name: 'Already open' })
    expect(within(thisDrive).getByText('streak resets at UTC')).toBeTruthy()
    expect(within(thisDrive).getByText('drive · main').getAttribute('title')).toBe(
      'noted while driving main @ 1882e87',
    )
    expect(within(older).getByText('already reported')).toBeTruthy()

    const box = within(rail).getByRole('textbox', { name: 'New note' })
    fireEvent.change(box, { target: { value: 'search has no empty state' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(addNote).toHaveBeenCalledWith({ projectId: 'proj_1', text: 'search has no empty state' })
  })

  it('shows the setup failure with Open preparation, and the rail still works', () => {
    slot = {
      ...LIVE,
      state: 'setup-failed',
      hookFailure: { command: 'bun run drive:setup', exitCode: 3, timedOut: false, output: 'port in use' },
    }
    const onOpenPreparation = vi.fn()
    mount(talk(), { onOpenPreparation })
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(screen.getByText('Drive setup failed')).toBeTruthy()
    expect(screen.getByText('port in use')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fix drive' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open preparation' }))
    expect(onOpenPreparation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'New note' })).toBeTruthy()
  })

  it('shows the bare state when setup ran and no dev command is set', () => {
    slot = { ...LIVE, state: 'bare-checkout', devConfigured: false, devUrl: undefined, devPaneId: undefined }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(screen.getByText('Setup ran — nothing started.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'New note' })).toBeTruthy()
  })
})

describe('a live chat beside a live drive', () => {
  it('switches which fills the body without ending either', () => {
    slot = LIVE
    mount(talk({ session: liveChat }))
    const chat = document.querySelector<HTMLElement>('[data-live-chat]')!
    const drive = document.querySelector<HTMLElement>('[data-project-drive]')!
    // the chat opened first, so it is in front; the switch is offered
    expect(shown(chat)).toBe(true)
    expect(shown(drive)).toBe(false)

    // view Tabs in each topbar
    fireEvent.click(within(chat).getByRole('tab', { name: 'Drive' }))
    expect(shown(drive)).toBe(true)
    expect(shown(chat)).toBe(false)

    fireEvent.click(within(drive).getByRole('tab', { name: 'Chat' }))
    expect(shown(chat)).toBe(true)
    expect(testDrive).not.toHaveBeenCalled()
  })

  it('offers no switch with only a drive live', () => {
    slot = LIVE
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(screen.queryByRole('tablist', { name: 'Show' })).toBeNull()
  })
})
