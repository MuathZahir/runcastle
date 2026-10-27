// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote, ScenarioEntry, ThreadEntry } from '@runcastle/core'
import type { ProjectConversation, ProjectSession } from '../src/lib/api'
import type { ProjectTalkApi } from '../src/lib/use-project-talk'
import { openMenu } from './floating'

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
const runScenario = vi.fn()
const openScenarioChat = vi.fn()
const threadNew = vi.fn()
/** What `thread.list` answers for the project. */
let threads: ThreadEntry[] = []
let scenarios: { runnerConfigured: boolean; scenarios: ScenarioEntry[] } = {
  runnerConfigured: false,
  scenarios: [],
}
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
        thread: { list: { invalidate } },
      }),
      thread: {
        list: { useQuery: () => ({ data: threads }) },
        new: {
          useMutation: (opts: { onSuccess: (r: { threadId: string }) => void }) => ({
            isPending: false,
            mutate: (input: unknown) => {
              threadNew(input)
              opts.onSuccess({ threadId: 'th_new' })
            },
          }),
        },
      },
      project: {
        list: { useQuery: () => ({ data: [project] }) },
        branches: { useQuery: () => ({ data: { current: 'main', detected: 'main', branches: [] } }) },
        conversationTranscript: {
          useQuery: () => ({
            isPending: false,
            data: { status: 'ok', runtime: 'claude-code', turns: [{ role: 'user', text: 'plan the audit' }] },
          }),
        },
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
        driveScenarios: { useQuery: () => ({ data: scenarios }) },
        runScenario: {
          useMutation: () => ({ isPending: false, mutate: (input: unknown) => runScenario(input) }),
        },
        openScenarioChat: {
          useMutation: (opts: { onSuccess: (r: { sessionId: string }) => void }) => ({
            isPending: false,
            mutate: (input: unknown) => {
              openScenarioChat(input)
              opts.onSuccess({ sessionId: 'sess_scn' })
            },
          }),
        },
        endSession: { useMutation: mutation },
        // The API view's Try it, mounted when a map door lands on the API side.
        sendCall: { useMutation: mutation },
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
// The thread itself is ThreadColumn's own test; here it names which thread is in front.
vi.mock('../src/components/chat/ThreadColumn', () => ({
  ThreadColumn: ({ label, threadId }: { label?: string; threadId: string | null }) => (
    <section aria-label={label} data-thread-column="" data-thread={threadId ?? 'new'} />
  ),
}))
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
  begin: vi.fn(),
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
  scenarios = { runnerConfigured: false, scenarios: [] }
  project = {
    id: 'proj_1',
    name: 'journal-app',
    repoPath: '/home/you/journal-app',
    driveSetupCommand: 'bun run drive:setup',
    devCommand: 'bun run dev',
  }
  notes = [note('already reported', 1_000)]
  threads = []
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Is this element in a part of the body the human can see? */
const shown = (el: HTMLElement): boolean => el.closest('[hidden], .hidden') === null

/** Is the resting page — its New chat card — what fills the chat column? */
function restShown(): boolean {
  const card = screen.queryByText('Talk it through')
  return card !== null && shown(card)
}

/** The panel beside the chat column, when one is open. */
const panel = (): HTMLElement | null => document.querySelector('[data-panel]')

function mount(
  api: ProjectTalkApi = talk(),
  props: { onOpenPreparation?: () => void; driveRequest?: number } = {},
) {
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
  it('starts a drive into the panel beside the chat list, then stops back to the Notes inbox', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
    rerender()

    // the chat column keeps the resting list; the drive opens in the panel
    expect(restShown()).toBe(true)
    const drivePanel = panel()!
    expect(within(drivePanel).getByRole('region', { name: 'Drive' })).toBeTruthy()
    const header = within(drivePanel).getByRole('heading', { name: 'Driving main' })
    expect(shown(header)).toBe(true)
    expect(screen.getByText('/home/you/journal-app @ 1882e87')).toBeTruthy()
    expect(within(drivePanel).getByTitle('the app on this branch')).toBeTruthy()
    expect(screen.getByText(/^dev server$/i)).toBeTruthy()
    const rail = within(drivePanel).getByRole('complementary', { name: 'Notes' })
    expect(within(rail).getByText('already reported')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop drive' }))
    expect(testDrive).toHaveBeenLastCalledWith({ projectId: 'proj_1', action: 'stop' })
    rerender()
    expect(restShown()).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Driving main' })).toBeNull()
    // the drive's notes are waiting in the inbox
    expect(within(panel()!).getAllByRole('region', { name: 'Notes' }).length).toBeGreaterThan(0)
  })

  it('toasts a refusal and stays at rest', () => {
    testDriveResult = { ok: false, deniedReason: 'A test drive of feature/x is running — stop it first' }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(toast).toHaveBeenCalledWith('A test drive of feature/x is running — stop it first')
    expect(restShown()).toBe(true)
  })

  it('opens the running drive in the panel, and closes the panel while the drive keeps running', () => {
    slot = LIVE
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(shown(screen.getByRole('heading', { name: 'Driving main' }))).toBe(true)
    expect(restShown()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Close the panel' }))
    rerender()
    expect(screen.queryByRole('heading', { name: 'Driving main' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Test drive' }).textContent).toContain('Running')
    expect(testDrive).not.toHaveBeenCalled()

    // the header's panel toggle reopens it at the drive, its last view
    fireEvent.click(screen.getByRole('button', { name: /^Show the panel/ }))
    expect(shown(screen.getByRole('heading', { name: 'Driving main' }))).toBe(true)
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

  // In a narrow panel (~670px at a 50/50 split of 1600px) the notes aside
  // floats over its row; the header's controls sit above that row, so the
  // aside can never cover them.
  it('keeps Stop drive and Hide notes outside the area the notes aside floats over', () => {
    slot = LIVE
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    const root = document.querySelector<HTMLElement>('[data-project-drive]')!
    const rail = within(root).getByRole('complementary', { name: 'Notes' })
    const asideRow = root.querySelector<HTMLElement>(':scope > .\\@container')!
    expect(asideRow.contains(rail)).toBe(true)
    const stop = within(root).getByRole('button', { name: 'Stop drive' })
    const hide = within(root).getByRole('button', { name: 'Hide notes' })
    expect(asideRow.contains(stop)).toBe(false)
    expect(asideRow.contains(hide)).toBe(false)

    fireEvent.click(hide)
    expect(within(root).queryByRole('complementary', { name: 'Notes' })).toBeNull()
    fireEvent.click(stop)
    expect(testDrive).toHaveBeenLastCalledWith({ projectId: 'proj_1', action: 'stop' })
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

const entry = (id: string, title: string, updatedAt = 1_000): ThreadEntry => ({
  id,
  title,
  role: 'project',
  state: 'idle',
  updatedAt,
  runtime: 'claude-code',
})

/** The chat in front of the column: its region, and which thread it shows. */
const chatInFront = (): HTMLElement | null => screen.queryByRole('region', { name: 'Project chat' })
const threadSwitcher = (): HTMLElement => screen.getByRole('button', { name: 'Thread' })

/**
 * A finished project chat is a thread like any other (chat-as-web-components
 * decision 7): it opens at once, with no Resume and nothing to end.
 */
describe('a finished project chat', () => {
  const ended = {
    id: 'sess_old',
    title: '',
    createdAt: 1_000,
    status: 'ended',
    resumable: true,
  } as ProjectConversation

  it('opens as its thread from the list, named in the header’s switcher, with no Resume or End session', () => {
    threads = [entry('sess_old', 'Untitled chat')]
    const api = talk({ conversations: [ended] })
    mount(api)
    fireEvent.click(screen.getByRole('button', { name: /Untitled chat/ }))

    expect(chatInFront()?.dataset.thread).toBe('sess_old')
    expect(threadSwitcher().closest('header')).toBeTruthy()
    expect(threadSwitcher().textContent).toContain('Untitled chat')
    openMenu(threadSwitcher())
    expect(screen.queryByRole('menuitem', { name: 'End session' })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Resume|Reopen/ })).toBeNull()
  })

  it('steps back to the project page from its crumb', () => {
    mount(talk({ conversations: [ended] }))
    fireEvent.click(screen.getByRole('button', { name: /Untitled chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    expect(restShown()).toBe(true)
    expect(chatInFront()).toBeNull()
  })

  it('opens New chat as an empty thread, nothing launched until its first message', () => {
    const api = talk()
    mount(api)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(chatInFront()?.dataset.thread).toBe('new')
    expect(api.start).not.toHaveBeenCalled()
  })
})

/** design-mode decision 11: the project page is chat-first, in the feature page's pieces. */
describe('a live project chat', () => {
  const liveRow = {
    id: 'sess_1',
    title: 'Audit the journal',
    createdAt: 1_000,
    status: 'live',
    resumable: true,
  } as ProjectConversation

  it('fills the chat column, with the drive opening beside it in the panel', () => {
    slot = LIVE
    mount(talk({ session: liveChat, conversations: [liveRow] }))
    expect(chatInFront()?.dataset.thread).toBe('sess_1')
    expect(restShown()).toBe(false)
    expect(panel()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Show the panel/ }))
    const drive = document.querySelector<HTMLElement>('[data-project-drive]')!
    // side by side: the drive in the panel, the chat still in its column
    expect(shown(drive)).toBe(true)
    expect(drive.closest('[data-panel]')).toBeTruthy()
    expect(chatInFront()).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'Resize the panel' })).toBeTruthy()
    expect(testDrive).not.toHaveBeenCalled()

    // the project crumb steps back to the chat list
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    expect(restShown()).toBe(true)
    expect(chatInFront()).toBeNull()
  })

  it('lists every chat of the project in its switcher, each opening its thread, and New thread selects a new one', () => {
    threads = [entry('sess_1', 'Audit the journal', 2_000), entry('sess_old', 'An older idea')]
    mount(talk({ session: liveChat, conversations: [liveRow] }))
    expect(threadSwitcher().textContent).toContain('Audit the journal')

    openMenu(threadSwitcher())
    const options = screen.getAllByRole('menuitemradio').map((o) => o.textContent ?? '')
    expect(options[0]).toContain('Audit the journal')
    expect(options[1]).toContain('An older idea')
    fireEvent.click(screen.getAllByRole('menuitemradio')[1])
    expect(chatInFront()?.dataset.thread).toBe('sess_old')

    openMenu(threadSwitcher())
    fireEvent.click(screen.getByRole('menuitem', { name: 'New thread' }))
    expect(threadNew).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(chatInFront()?.dataset.thread).toBe('th_new')
  })

  it('has one header row, and no End session in its switcher', () => {
    mount(talk({ session: liveChat, conversations: [liveRow] }))
    expect([...document.querySelectorAll('header')].filter(shown)).toHaveLength(1)
    openMenu(threadSwitcher())
    expect(screen.queryByRole('menuitem', { name: 'End session' })).toBeNull()
  })

  it('opens the panel toggle at the Notes while no drive is up, counting the open ones', () => {
    mount(talk({ session: liveChat }))
    const toggle = screen.getByRole('button', { name: /^Show the panel/ })
    expect(toggle.textContent).toContain('1')
    fireEvent.click(toggle)
    expect(document.querySelector('[data-panel]')?.textContent).toContain('Notes')
    expect(document.querySelector('[data-project-drive]')).toBeNull()
  })

  it('starts the project test drive from the topbar without leaving the chat', () => {
    const { rerender } = mount(talk({ session: liveChat, conversations: [liveRow] }))
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
    rerender()

    // the drive opens in the panel beside the chat, which stays in front
    expect(document.querySelector('[data-project-drive]')!.closest('[data-panel]')).toBeTruthy()
    expect(chatInFront()).toBeTruthy()
    expect(restShown()).toBe(false)
    // once it is up, the panel toggle is the way to it
    expect(screen.queryByRole('button', { name: 'Test drive' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Hide the panel/ })).toBeTruthy()
  })

  it('names the holder on a disabled topbar Test drive while another drive has the slot', () => {
    slot = { ...LIVE, projectDrive: undefined, projectId: undefined, holderLabel: 'a test drive of feature/streaks' }
    mount(talk({ session: liveChat, conversations: [liveRow] }))
    const button = screen.getByRole('button', { name: 'Test drive' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('A test drive of feature/streaks is running')
  })
})

// drive-scenarios decision 7: a project drive lists every scenario with no
// "This feature" section, and its main click is the blank app.
describe('scenarios on a project drive', () => {
  const SCENARIOS: ScenarioEntry[] = [
    { file: '.runcastle/scenarios/smoke.ts', name: 'Smoke', own: false, hasCall: false },
    { file: '.runcastle/scenarios/review/feature-at-review.ts', name: 'Feature at review', group: 'Review', own: true, hasCall: false },
    { file: '.runcastle/scenarios/auth/signed-out.ts', name: 'Signed out', group: 'Auth', own: false, hasCall: false },
  ]

  it('starts on the blank app from the main click', () => {
    scenarios = { runnerConfigured: true, scenarios: SCENARIOS }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
  })

  it('lists every scenario by group, Blank app last, and starts on the one picked', () => {
    scenarios = { runnerConfigured: true, scenarios: SCENARIOS }
    mount()
    openMenu(screen.getByRole('button', { name: 'Choose a scenario' }))

    const menu = screen.getByRole('menu')
    expect(menu.textContent).not.toContain('This feature')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Signed outAuth',
      'Feature at reviewReview',
      'Smoke',
      'Blank app',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Feature at review/ }))
    expect(testDrive).toHaveBeenCalledWith({
      projectId: 'proj_1',
      action: 'start',
      scenario: '.runcastle/scenarios/review/feature-at-review.ts',
    })
  })

  it('offers only Blank app with no scenario runner set', () => {
    scenarios = { runnerConfigured: false, scenarios: SCENARIOS }
    mount()
    openMenu(screen.getByRole('button', { name: 'Choose a scenario' }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Blank app'])
  })

  it('carries the Scenario menu in the running drive, which runs the one picked without a restart', () => {
    scenarios = { runnerConfigured: true, scenarios: SCENARIOS }
    slot = LIVE
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    openMenu(screen.getByRole('button', { name: 'Scenario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Smoke/ }))

    expect(runScenario).toHaveBeenCalledWith({ projectId: 'proj_1', file: '.runcastle/scenarios/smoke.ts' })
    expect(testDrive).not.toHaveBeenCalled()
  })
})

describe('the titlebar drive pill', () => {
  it('brings a live drive to the front', () => {
    slot = LIVE
    mount(talk(), { driveRequest: 1 })
    expect(shown(screen.getByRole('heading', { name: 'Driving main' }))).toBe(true)
    expect(runScenario).not.toHaveBeenCalled()
    expect(testDrive).not.toHaveBeenCalled()
  })
})

