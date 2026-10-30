// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote, ScenarioEntry, ThreadEntry } from '@runcastle/core'
import type { ProjectSession } from '../src/lib/api'
import type { ProjectTalkApi } from '../src/lib/use-project-talk'
import { openList, openMenu } from './floating'

/**
 * The project drive on the project workspace (project-level-test-drive
 * decisions 4, 7): the Test drive card on the resting page, starting a drive
 * makes the drive the page with its notes rail (test-drive-looks-the-part
 * decision 13), the back arrow steps back while the drive runs, Stop lands on
 * the Notes inbox.
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
const threadRename = vi.fn()
const threadExport = vi.fn((_input: unknown) => ({ markdown: '# Audit the journal\n' }))
/** What `thread.list` answers for the project. */
let threads: ThreadEntry[] = []
/** Whether `thread.list` has answered yet. */
let threadsAnswered = true
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
        feature: { driveInfo: { invalidate }, list: { invalidate }, get: { invalidate } },
        thread: { list: { invalidate }, export: { fetch: async (input: unknown) => threadExport(input) } },
      }),
      // The sidebar's reads, for the tests that mount it beside the page.
      useQueries: () => [],
      events: { listByProject: { useQuery: () => ({ data: undefined }) } },
      thread: {
        list: { useQuery: () => ({ data: threadsAnswered ? threads : undefined, isPending: !threadsAnswered }) },
        rename: {
          useMutation: () => ({ isPending: false, mutate: (input: { threadId: string; title: string }) => threadRename(input) }),
        },
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
        prep: { useQuery: () => ({ data: undefined }) },
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
        openCount: { useQuery: () => ({ data: 0 }) },
        add: { useMutation: () => ({ mutateAsync: addNote }) },
        edit: { useMutation: mutation },
        delete: { useMutation: mutation },
        dismiss: { useMutation: mutation },
        reopen: { useMutation: mutation },
      },
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
        testDrive: { useMutation: mutation },
        archive: { useMutation: mutation },
        unarchive: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false, useLiveStatus: () => 'live' }))
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
  ThreadOpening: () => <section aria-label="Chat" aria-busy="true" data-thread-column="" />,
}))
vi.mock('../src/lib/project-notes', () => ({
  uploadProjectNoteScreenshot: vi.fn(),
  isNoteHotkey: () => false,
}))

const { ProjectWorkspace } = await import('../src/components/ProjectWorkspace')
const { Sidebar } = await import('../src/components/Sidebar')
const { SidebarThreadsProvider } = await import('../src/lib/sidebar-threads')

const talk = (over: Partial<ProjectTalkApi> = {}): ProjectTalkApi => ({
  session: null,
  state: 'none',
  triage: vi.fn(),
  triaging: false,
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
  threadsAnswered = true
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
  // The thread a test opened rides in the address; the next test starts clean.
  window.history.replaceState(null, '', '/')
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

/** The drive page, mounted while a drive runs, and on show or not. */
const drivePage = (): HTMLElement | null => document.querySelector('[data-drive-page]')
const onDrive = (): boolean => {
  const page = drivePage()
  return page !== null && shown(page)
}

function mount(
  api: ProjectTalkApi = talk(),
  props: { onOpenPreparation?: () => void; driveRequest?: number } = {},
) {
  const view = render(<ProjectWorkspace projectId="proj_1" talk={api} {...props} />)
  return { rerender: () => view.rerender(<ProjectWorkspace projectId="proj_1" talk={api} {...props} />) }
}

/**
 * The page beside the project sidebar, as the project shell lays them out: the
 * Orchestrator's chats list in its card (threads-in-the-sidebar).
 */
function mountWithSidebar(api: ProjectTalkApi = talk()) {
  const nav = {
    // Named apart from the page's own crumb, so the two never share a button name.
    projects: [{ id: 'proj_1', name: 'nav-project', repoPath: '/repo' }],
    loading: false,
    doctorError: null,
    recheckDoctor: () => {},
    view: 'project' as const,
    currentProjectId: 'proj_1',
    currentProject: { id: 'proj_1', name: 'nav-project', repoPath: '/repo' },
    goHome: () => {},
    enterProject: () => {},
    showOpen: () => {},
    cancelOpen: () => {},
  }
  const tree = () => (
    <SidebarThreadsProvider>
      <div data-sidebar="">
        <Sidebar
          projectId="proj_1"
          nav={nav}
          view="project"
          selectedFeatureId={null}
          onSelect={() => {}}
          onSelectProject={() => {}}
          onNewChat={() => {}}
          onDraft={() => {}}
          onOpenPreparation={() => {}}
        />
      </div>
      <ProjectWorkspace projectId="proj_1" talk={api} />
    </SidebarThreadsProvider>
  )
  const view = render(tree())
  return { rerender: () => view.rerender(tree()) }
}

const sidebar = (): HTMLElement => document.querySelector('[data-sidebar]') as HTMLElement
/** The Orchestrator's chats as its card lists them: each row's title, in order. */
const orchestratorChats = (): string[] => {
  const list = within(sidebar()).queryByRole('list', { name: 'Conversations' })
  return list ? within(list).getAllByRole('button').flatMap((b) => (b.title ? [b.title] : [])) : []
}
/** A chat's row in the Orchestrator's card. */
const chatRow = (title: string): HTMLElement =>
  within(within(sidebar()).getByRole('list', { name: 'Conversations' })).getByTitle(title).parentElement as HTMLElement
/** The header's name for the chat in front: the breadcrumb's last item. */
const chatName = (): string => document.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]')?.textContent ?? ''

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
  it('starts a drive as the page, then stops back to the Notes inbox', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
    rerender()

    // the drive replaces the chat column and the panel
    expect(onDrive()).toBe(true)
    expect(restShown()).toBe(false)
    expect(panel()).toBeNull()
    const page = drivePage()!
    expect(page.textContent).toContain('Driving main')
    expect(screen.getByText('/home/you/journal-app @ 1882e87')).toBeTruthy()
    expect(within(page).getByTitle('the app on this branch')).toBeTruthy()
    expect(screen.getByText(/^dev server$/i)).toBeTruthy()
    const rail = within(page).getByRole('complementary', { name: 'Notes' })
    expect(within(rail).getByText('already reported')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop drive' }))
    expect(testDrive).toHaveBeenLastCalledWith({ projectId: 'proj_1', action: 'stop' })
    rerender()
    expect(restShown()).toBe(true)
    expect(drivePage()).toBeNull()
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

  it('opens the running drive as the page, and steps back while the drive keeps running', () => {
    slot = LIVE
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(onDrive()).toBe(true)
    expect(restShown()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    rerender()
    expect(restShown()).toBe(true)
    expect(screen.getByRole('region', { name: 'Test drive' }).textContent).toContain('Running')
    expect(testDrive).not.toHaveBeenCalled()
    // Still mounted, hidden: the app stays as it was left.
    expect(drivePage()).not.toBeNull()
    expect(onDrive()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(onDrive()).toBe(true)
  })

  it("lists this drive's notes apart from the older ones, and saves the box's note on Enter", async () => {
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
    expect(within(older).getByText('already reported')).toBeTruthy()

    const box = within(rail).getByRole('textbox', { name: 'Note' })
    fireEvent.change(box, { target: { value: 'search has no empty state' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(addNote).toHaveBeenCalledWith({ projectId: 'proj_1', text: 'search has no empty state' })
  })

  it('folds the rail from the head, where Stop drive also is', () => {
    slot = LIVE
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    const page = drivePage()!
    fireEvent.click(within(page).getByRole('button', { name: 'Hide notes' }))
    expect(within(page).queryByRole('complementary', { name: 'Notes' })).toBeNull()
    fireEvent.click(within(page).getByRole('button', { name: 'Stop drive' }))
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
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeTruthy()
  })

  it('shows the bare state when setup ran and no dev command is set', () => {
    slot = { ...LIVE, state: 'bare-checkout', devConfigured: false, devUrl: undefined, devPaneId: undefined }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    expect(screen.getByText('Branch checked out, nothing started')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeTruthy()
  })
})

const entry = (id: string, title: string, updatedAt = 1_000): ThreadEntry => ({
  id,
  title,
  role: 'project',
  state: 'idle',
  createdAt: updatedAt,
  updatedAt,
  runtime: 'claude-code',
})

/** The chat in front of the column: its region, and which thread it shows. */
const chatInFront = (): HTMLElement | null => screen.queryByRole('region', { name: 'Project chat' })

/**
 * A finished project chat is a thread like any other (chat-as-web-components
 * decision 7): it opens at once, with no Resume and nothing to end.
 */
describe('a finished project chat', () => {
  it('opens as its thread from the list, named in the header, with no Resume', () => {
    threads = [entry('sess_old', 'Plan the audit')]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Plan the audit/ }))

    expect(chatInFront()?.dataset.thread).toBe('sess_old')
    expect(chatName()).toBe('Plan the audit')
    expect(screen.queryByRole('button', { name: 'Thread' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Resume|Reopen/ })).toBeNull()
  })

  it('steps back to the project page from its crumb', () => {
    threads = [entry('sess_old', 'Plan the audit')]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Plan the audit/ }))
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    expect(restShown()).toBe(true)
    expect(chatInFront()).toBeNull()
  })
})

/**
 * chat-as-web-components decision 14: every new-chat door opens an empty new
 * thread, whatever else is running — no "a chat is already open" notice.
 */
describe('New chat with a chat running', () => {
  const running = (): void => {
    threads = [entry('sess_1', 'Audit the journal', 2_000), entry('sess_old', 'An older idea')]
  }

  it('opens an empty new thread from the New chat row, with no notice', () => {
    running()
    mount(talk({ session: liveChat }))
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(threadNew).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(chatInFront()?.dataset.thread).toBe('th_new')
    expect(screen.queryByText(/already open|End it and start new/)).toBeNull()
    // named "New chat" until something is said in it, never by its kind
    expect(chatName()).toBe('New chat')
  })

  // The project page's New door (ProjectShell, the sidebar's Create menu) asks through `newChatRequest`.
  it('opens an empty new thread from the New door too', () => {
    running()
    const consumed = vi.fn()
    render(<ProjectWorkspace projectId="proj_1" talk={talk({ session: liveChat })} newChatRequest={1} onConsumeNewChatRequest={consumed} />)
    expect(threadNew).toHaveBeenCalledTimes(1)
    expect(chatInFront()?.dataset.thread).toBe('th_new')
    expect(consumed).toHaveBeenCalled()
  })

  it('opens an empty new thread from the Orchestrator’s "+" the same way', () => {
    running()
    mountWithSidebar(talk({ session: liveChat }))
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'New thread' }))
    expect(threadNew).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(chatInFront()?.dataset.thread).toBe('th_new')
  })

  it('lists the same threads, names and states on the page as in the Orchestrator’s card', () => {
    threads = [
      { ...entry('sess_1', 'Audit the journal', 3_000), state: 'working' },
      { ...entry('sess_2', 'Cut the export idea', 2_000), state: 'waiting' },
      entry('sess_old', 'An older idea'),
    ]
    mountWithSidebar(talk({ session: liveChat }))
    // Newest started first (decision 3): these were started in the order of their last move.
    expect(orchestratorChats()).toEqual(['Audit the journal', 'Cut the export idea', 'An older idea'])
    expect(chatRow('Audit the journal').querySelector('[data-progress]')).not.toBeNull()
    expect(within(chatRow('Cut the export idea')).getByLabelText('Waiting for you')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    const onPage = [...document.querySelectorAll('[aria-label="Chats"] [data-list-row]')].map((row) => row.textContent ?? '')

    expect(onPage).toHaveLength(3)
    const expected = [
      ['Audit the journal', 'working'],
      ['Cut the export idea', 'waiting for you'],
      ['An older idea', 'd'],
    ]
    expected.forEach(([name, state], i) => {
      expect(onPage[i]).toContain(name)
      expect(onPage[i]).toContain(state)
    })
  })
})

/** design-mode decision 11: the project page is chat-first, in the feature page's pieces. */
describe('a live project chat', () => {
  it('fills the chat column, and the drive takes the page from it and gives it back', () => {
    slot = LIVE
    mount(talk({ session: liveChat }))
    expect(chatInFront()?.dataset.thread).toBe('sess_1')
    expect(restShown()).toBe(false)
    expect(panel()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the drive' }))
    expect(onDrive()).toBe(true)
    expect(shown(chatInFront()!)).toBe(false)
    expect(screen.queryByRole('separator', { name: 'Resize the panel' })).toBeNull()
    expect(testDrive).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    expect(onDrive()).toBe(false)
    expect(shown(chatInFront()!)).toBe(true)

    // the project crumb steps back to the chat list
    fireEvent.click(screen.getByRole('button', { name: 'journal-app' }))
    expect(restShown()).toBe(true)
    expect(chatInFront()).toBeNull()
  })

  it('lists every chat of the project in the Orchestrator’s card, each opening its thread, and "+" selects a new one', () => {
    threads = [entry('sess_1', 'Audit the journal', 2_000), entry('sess_old', 'An older idea')]
    mountWithSidebar(talk({ session: liveChat }))
    expect(chatName()).toBe('Audit the journal')

    expect(orchestratorChats()).toEqual(['Audit the journal', 'An older idea'])
    fireEvent.click(within(sidebar()).getByTitle('An older idea'))
    expect(chatInFront()?.dataset.thread).toBe('sess_old')
    expect(chatName()).toBe('An older idea')

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'New thread' }))
    expect(threadNew).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(chatInFront()?.dataset.thread).toBe('th_new')
  })

  it('keeps the chat in front in the address, and a reload reopens it', async () => {
    window.history.replaceState(null, '', '/p/proj_1/chat')
    threads = [entry('sess_1', 'Audit the journal', 2_000), entry('sess_old', 'An older idea')]
    mountWithSidebar(talk({ session: liveChat }))
    fireEvent.click(within(sidebar()).getByTitle('An older idea'))
    await waitFor(() => expect(window.location.search).toBe('?thread=sess_old'))
    expect(window.location.pathname).toBe('/p/proj_1/chat')

    cleanup()
    mount(talk({ session: liveChat }))
    expect(chatInFront()?.dataset.thread).toBe('sess_old')
  })

  it('opens the chat a reloaded or pasted link names, not the overview, even when the list answers late', async () => {
    window.history.replaceState(null, '', '/p/proj_1/chat?thread=sess_old')
    threads = [entry('sess_1', 'Audit the journal', 2_000), entry('sess_old', 'An older idea')]
    threadsAnswered = false
    const { rerender } = mount(talk({ session: liveChat }))
    // Pending: neither the resting list nor the running chat, and the link stays.
    expect(screen.getByRole('region', { name: 'Chat' }).getAttribute('aria-busy')).toBe('true')
    expect(restShown()).toBe(false)
    expect(chatInFront()).toBeNull()
    await act(() => new Promise((r) => setTimeout(r, 10)))
    expect(window.location.search).toBe('?thread=sess_old')

    threadsAnswered = true
    rerender()
    expect(chatInFront()?.dataset.thread).toBe('sess_old')
    expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull()
  })

  it('drops a ?thread= that is not one of the project’s chats once a late list answers', async () => {
    window.history.replaceState(null, '', '/p/proj_1/chat?thread=th_a_feature_chat')
    threads = [entry('sess_1', 'Audit the journal', 2_000)]
    threadsAnswered = false
    const { rerender } = mount(talk({ session: liveChat }))
    expect(chatInFront()).toBeNull()

    threadsAnswered = true
    rerender()
    expect(chatInFront()?.dataset.thread).toBe('sess_1')
    await waitFor(() => expect(window.location.search).toBe('?thread=sess_1'))
  })

  it('ignores a ?thread= that is not one of the project’s chats, and drops it from the address', async () => {
    window.history.replaceState(null, '', '/p/proj_1/chat?thread=th_a_feature_chat')
    threads = [entry('sess_1', 'Audit the journal', 2_000)]
    mount(talk({ session: liveChat }))
    expect(chatInFront()?.dataset.thread).toBe('sess_1')
    await waitFor(() => expect(window.location.search).toBe('?thread=sess_1'))
  })

  it('renames a chat from its row’s menu in the Orchestrator’s card: Enter saves through thread.rename, Escape cancels', () => {
    threads = [entry('sess_1', 'Audit the journal', 2_000)]
    mountWithSidebar(talk({ session: liveChat }))
    openMenu(within(chatRow('Audit the journal')).getByRole('button', { name: 'Thread actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    const field = screen.getByRole('textbox', { name: 'Thread name' }) as HTMLInputElement
    expect(field.value).toBe('Audit the journal')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Rename thread' })).toBeNull()
    expect(threadRename).not.toHaveBeenCalled()

    openMenu(within(chatRow('Audit the journal')).getByRole('button', { name: 'Thread actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    const again = screen.getByRole('textbox', { name: 'Thread name' })
    fireEvent.change(again, { target: { value: 'Journal audit' } })
    fireEvent.submit(again.closest('form')!)
    expect(threadRename).toHaveBeenCalledWith({ threadId: 'sess_1', title: 'Journal audit' })
    expect(screen.queryByRole('dialog', { name: 'Rename thread' })).toBeNull()
  })

  it('exports a chat from its row’s menu as a downloaded Markdown file named by its title', async () => {
    threads = [entry('sess_1', 'Audit the journal', 2_000)]
    URL.createObjectURL = vi.fn(() => 'blob:md')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mountWithSidebar(talk({ session: liveChat }))
    openMenu(within(chatRow('Audit the journal')).getByRole('button', { name: 'Thread actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export as Markdown' }))
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(threadExport).toHaveBeenCalledWith({ threadId: 'sess_1' })
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('Audit the journal.md')
    expect(link.href).toBe('blob:md')
    click.mockRestore()
  })

  it('has one header row, naming the chat in front with no switcher', () => {
    mount(talk({ session: liveChat }))
    expect([...document.querySelectorAll('header')].filter(shown)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Thread' })).toBeNull()
  })

  it('opens the panel toggle at the Notes while no drive is up, counting the open ones', () => {
    mount(talk({ session: liveChat }))
    const toggle = screen.getByRole('button', { name: /^Show the panel/ })
    expect(toggle.textContent).toContain('1')
    fireEvent.click(toggle)
    expect(document.querySelector('[data-panel]')?.textContent).toContain('Notes')
    expect(drivePage()).toBeNull()
  })

  it('starts the project test drive from the topbar, and goes back to it from there', () => {
    const { rerender } = mount(talk({ session: liveChat }))
    fireEvent.click(screen.getByRole('button', { name: 'Test drive' }))
    expect(testDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'start' })
    rerender()

    // the drive takes the page from the chat
    expect(onDrive()).toBe(true)
    expect(shown(chatInFront()!)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    // once it is up, the topbar's button is the way back to it
    expect(screen.queryByRole('button', { name: 'Test drive' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to the drive' })).toBeTruthy()
  })

  it('names the holder on a disabled topbar Test drive while another drive has the slot', () => {
    slot = { ...LIVE, projectDrive: undefined, projectId: undefined, holderLabel: 'a test drive of feature/streaks' }
    mount(talk({ session: liveChat }))
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
    expect(openList(screen.getByRole('button', { name: 'Choose a scenario' }))).toEqual([
      'Signed out',
      'Feature at review',
      'Smoke',
      'Blank app',
    ])
    expect(screen.getByRole('listbox').textContent).not.toContain('This feature')
    fireEvent.click(screen.getByRole('option', { name: /Feature at review/ }))
    expect(testDrive).toHaveBeenCalledWith({
      projectId: 'proj_1',
      action: 'start',
      scenario: '.runcastle/scenarios/review/feature-at-review.ts',
    })
  })

  it('offers only Blank app with no scenario runner set', () => {
    scenarios = { runnerConfigured: false, scenarios: SCENARIOS }
    mount()
    expect(openList(screen.getByRole('button', { name: 'Choose a scenario' }))).toEqual(['Blank app'])
  })

  it('carries the scenario control in the running drive, which runs the one picked without a restart', () => {
    scenarios = { runnerConfigured: true, scenarios: SCENARIOS }
    slot = LIVE
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Return to drive' }))
    openList(within(drivePage()!).getByRole('button', { name: /Blank app/ }))
    fireEvent.click(screen.getByRole('option', { name: /Smoke/ }))

    expect(runScenario).toHaveBeenCalledWith({ projectId: 'proj_1', file: '.runcastle/scenarios/smoke.ts' })
    expect(testDrive).not.toHaveBeenCalled()
  })
})

describe('the titlebar drive pill', () => {
  it('brings a live drive to the front', () => {
    slot = LIVE
    mount(talk(), { driveRequest: 1 })
    expect(onDrive()).toBe(true)
    expect(runScenario).not.toHaveBeenCalled()
    expect(testDrive).not.toHaveBeenCalled()
  })
})

