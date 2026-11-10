// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveScenario, FeatureNeed, ThreadEntry, ThreadEvent } from '@runcastle/core'
import type { FeatureFull, WorkerListRow } from '../src/lib/api'
import { fakeTrpc, type FakeHandlers } from './fake-trpc'
import { full as fixture, listItem } from './fixtures'
import { openMenu, openList } from './floating'

/**
 * The feature page's chat column (chat-as-web-components decision 7) and the
 * feature's own sidebar page (interactive-workers decision 24): opening a
 * feature swaps the sidebar to its page, fed by `worker.list` and the threads
 * the page publishes, and the column shows the thread in front through
 * ThreadColumn, a worker's with its assignment card and its header's actions.
 * A drive errand brings its scenario chat to the front and closing it hands
 * the column back; the page's "+" starts a worker with no assignment.
 *
 * Tier 2: row menus are portalled. The seam is the page as it assembles its
 * column and publishes its threads, beside the real sidebar, on the app's real
 * tRPC hooks; the server is faked by path.
 */

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ScenarioChatContext } = await import('../src/components/chat/ScenarioChat')
const { Sidebar } = await import('../src/components/Sidebar')
const { SidebarThreadsProvider, usePublishSidebarThreads } = await import('../src/lib/sidebar-threads')
const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { FeatureChat } = await import('../src/components/workspace/FeatureChat')
const { ScenarioDrive } = await import('../src/components/review/ScenarioDrive')
const { mainChatInbox, putInInbox } = await import('../src/lib/composer-inbox')
const { AddressSettled, useHistorySync } = await import('../src/lib/use-history-sync')
const { featureStatus, mainChatWorking } = await import('../src/lib/feature-ui/status-line')
const { FeatureStatusLine } = await import('../src/components/workspace/FeatureStatusLine')
const { SidebarFeatureRow } = await import('../src/components/SidebarParts')
const { useFeatureWorkers, useWorkerHeader, workerInFront } = await import('../src/components/workers/WorkerChat')
const { trpc } = await import('../src/trpc')

const FAILED: DriveScenario = {
  file: '.runcastle/scenarios/checkout/expired-coupon.ts',
  name: 'Expired coupon',
  status: 'failed',
  failure: { reason: 'exit', exitCode: 1, outputTail: 'boom' },
}

const at = 1_700_000_000_000
const thread = (id: string, title: string, role: ThreadEntry['role'], over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id,
  title,
  role,
  state: 'idle',
  createdAt: at,
  updatedAt: at,
  runtime: 'claude-code',
  ...over,
})
/** Each thread's log says which thread it is. */
const logOf = (threadId: string): ThreadEvent[] => [
  { i: 0, at, type: 'prompt', id: `p_${threadId}`, text: `said in ${threadId}`, source: 'human' },
]

/** A worker as `worker.list` serves it; its thread is `thread(id, label, 'worker')`. */
const worker = (id: string, label: string, over: Partial<WorkerListRow> = {}): WorkerListRow => ({
  id,
  featureId: 'feat_1',
  projectId: 'proj_1',
  label,
  purpose: `What ${label} is for`,
  kind: 'with-you',
  goal: `Build ${label}`,
  doneWhen: 'The human is happy',
  model: 'claude-opus-5-5',
  runtime: 'claude-code',
  startedBy: 'lead',
  status: 'needs-you',
  failure: null,
  engine: 'docker',
  container: `rc-${id}`,
  branch: `runcastle/worker/${id}`,
  featureBranch: 'feature/demo',
  previewPort: null,
  devServer: false,
  handbackSummary: null,
  handbackCommits: null,
  handbackFiles: null,
  outcome: null,
  outcomeNote: null,
  tokens: null,
  reviewMode: null,
  reviewVerify: null,
  createdAt: at,
  updatedAt: at,
  previewPath: null,
  passPort: 4514,
  heldBy: null,
  ...over,
})

function server({
  threads = [thread('th_main', 'Feature chat', 'main')],
  workers = [],
  extra = {},
}: { threads?: ThreadEntry[]; workers?: WorkerListRow[]; extra?: FakeHandlers } = {}) {
  const list = [...threads]
  const rows = [...workers]
  return fakeTrpc({
    'thread.list': () => [...list],
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': ({ threadId }: { threadId: string }) => ({ events: logOf(threadId) }),
    'worker.list': () => [...rows],
    'worker.startUnassigned': () => {
      list.push(thread('th_new', 'New worker', 'worker'))
      rows.push(worker('th_new', 'New worker', { kind: 'unassigned', startedBy: 'human', purpose: 'Started by you', goal: null, doneWhen: null }))
      return { workerId: 'th_new', branch: 'runcastle/worker/th_new', previewUrl: '' }
    },
    'worker.handBack': () => ({ ok: true }),
    'thread.send': () => ({ promptId: 'p_sent' }),
    'feature.launchSession': () => ({ sessionId: 'th_started' }),
    'feature.driveScenarios': () => ({ runnerConfigured: true, scenarios: [] }),
    'feature.openScenarioChat': () => ({ sessionId: 'th_scn' }),
    // The sidebar's own read: the open feature's row, in its lane, with its
    // workers arrow while its workers page lists anything (clicking-a-feature-opens-its-lead decision 4).
    'feature.list': () =>
      ['feat_1', 'feat_a', 'feat_b'].map((id) => {
        const page = id === 'feat_1' && (rows.length > 0 || list.some((t) => t.role === 'side' || t.role === 'old-drive-chat'))
        const inPlay = rows.filter((w) => ['needs-you', 'failed', 'working', 'queued'].includes(w.status)).length
        return listItem({ id, slug: id, ...(page ? { workersPage: { inPlay } } : {}) })
      }),
    ...extra,
  })
}

const nav = {
  projects: [{ id: 'proj_1', name: 'shop-app', repoPath: '/repo' }],
  loading: false,
  doctorError: null,
  recheckDoctor: () => {},
  view: 'project' as const,
  currentProjectId: 'proj_1',
  currentProject: { id: 'proj_1', name: 'shop-app', repoPath: '/repo' },
  goHome: () => {},
  enterProject: () => {},
  showOpen: () => {},
  cancelOpen: () => {},
}

type PageProps = { featureId?: string; driveSessionId?: string; scenario?: DriveScenario; sessions?: FeatureFull['sessions']; worked?: boolean; onSelect?: (id: string | null) => void }

/** The feature page beside the project sidebar, as the project shell lays them out. */
function Page(props: PageProps) {
  return (
    <SidebarThreadsProvider>
      <div data-sidebar="">
        <Sidebar
          projectId="proj_1"
          nav={nav}
          view="feature"
          selectedFeatureId={props.featureId ?? 'feat_1'}
          onSelect={props.onSelect ?? (() => {})}
          onSelectProject={() => {}}
          onNewChat={() => {}}
          onDraft={() => {}}
        />
      </div>
      <FeaturePage {...props} />
    </SidebarThreadsProvider>
  )
}

/** The page's column beside its drive panel, its threads published and named, as Workspace does it. */
function FeaturePage({ featureId = 'feat_1', driveSessionId, scenario, sessions = [], worked = false }: PageProps) {
  const column = useFeatureChatColumn({ featureId, sessions, driveSessionId })
  usePublishSidebarThreads({
    scope: { featureId },
    threads: column.threads,
    current: column.current,
    pick: column.pick,
    newThread: column.newThread,
    ...(column.scenario.sessionId && column.scenario.listed
      ? { errand: { threadId: column.scenario.sessionId, close: column.scenario.close } }
      : {}),
  })
  // A feature with history: a new one starts its chat by itself (feature-chat-start.test.tsx).
  const full = { ...fixture({ id: featureId }), sessions, tickets: [], runs: worked ? [{ id: 'run_1' }] : [] } as unknown as FeatureFull
  // The header's worker status and actions, as Workspace derives them.
  const workerHeader = useWorkerHeader(
    workerInFront(useFeatureWorkers(featureId), column.threads, column.inFront !== column.main ? column.inFront : null),
  )
  return (
    <ScenarioChatContext.Provider value={column.scenario}>
      <header data-thread-name="">{column.threads.find((t) => t.id === column.current)?.title}</header>
      <div data-header="">
        {workerHeader?.status}
        {workerHeader?.actions}
      </div>
      <div data-column="">
        <FeatureChat
          full={full}
          column={column}
          events={[]}
          hidden={false}
          holdStart={false}
          start={async () => 'th_started'}
          onPlanItYourself={async () => undefined}
          onView={() => {}}
        />
      </div>
      <div data-panel="">
        <ScenarioDrive projectId="proj_1" featureId={featureId} drive={{ devUrl: 'about:blank', ...(scenario ? { scenario } : {}) }} />
      </div>
    </ScenarioChatContext.Provider>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

/** An answer the test gives when it chooses. */
function later<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
/** Let the address writes, which wait a tick, land. */
const tick = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 10)))

/** The header's name for the thread in front. */
const threadName = (): HTMLElement => document.querySelector('[data-thread-name]') as HTMLElement
const column = (): HTMLElement => document.querySelector('[data-column]') as HTMLElement
const sidebar = (): HTMLElement => document.querySelector('[data-sidebar]') as HTMLElement
/** The page header's worker status and actions. */
const header = (): HTMLElement => document.querySelector('[data-header]') as HTMLElement
/** The open feature's own sidebar page (decision 24); null while the sidebar shows the features list. */
const featurePage = (): HTMLElement | null => within(sidebar()).queryByRole('region', { name: 'Demo' })
/** The open feature's workers arrow, which alone goes down to its page (clicking-a-feature-opens-its-lead decisions 2, 3). */
const arrow = (): Promise<HTMLElement> => within(sidebar()).findByRole('button', { name: /^Workers/ })
/** Press the arrow and wait for the feature's page. */
const down = async (): Promise<void> => {
  fireEvent.click(await arrow())
  await waitFor(() => expect(featurePage()).not.toBeNull())
}
/** A list of chats inside the Lead card, which the drive's chats no longer get: they are workers. */
const threadList = (): HTMLElement | null => within(sidebar()).queryByRole('list', { name: 'Chats' })
/** A lane of the feature's page: its rows' labels, in order. */
const lane = (name: 'Needs you' | 'Working' | 'Done'): string[] => {
  const section = within(featurePage()!).queryByRole('region', { name })
  return section ? within(section).getAllByRole('button').flatMap((b) => (b.title ? [b.title.split(' — ')[0]!] : [])) : []
}
/** Unfold the Done lane. */
const openDone = (): void => {
  fireEvent.click(within(within(featurePage()!).getByRole('region', { name: 'Done' })).getAllByRole('button')[0]!)
}
/** A worker's row on the feature's page, by its label. */
const pickWorker = (label: string): void => {
  const row = within(featurePage()!)
    .getAllByRole('button')
    .find((b) => b.title === label || b.title.startsWith(`${label} — `))
  if (!row) throw new Error(`no worker row "${label}"`)
  fireEvent.click(row)
}
/** The Lead card. */
const leadCard = (): HTMLElement => within(featurePage()!).getByRole('button', { name: /^Lead(?! actions)/ })
const newScenario = (): void => {
  openList(screen.getByRole('button', { name: /Blank app/ }))
  fireEvent.click(screen.getByRole('option', { name: 'New scenario' }))
}

describe('the open feature’s own sidebar page (interactive-workers decisions 3, 7, 23, 24)', () => {
  const lead = thread('th_main', 'Feature chat', 'main')
  const mixed = {
    threads: [
      lead,
      thread('w_ask', 'Header', 'worker'),
      thread('w_fail', 'Search', 'worker'),
      thread('w_run', 'Data', 'worker'),
      thread('w_line', 'Docs', 'worker'),
      thread('w_back', 'Footer', 'worker'),
      thread('th_old', 'An old side thread', 'side', { createdAt: at - 9 }),
    ],
    workers: [
      worker('w_ask', 'Header', { createdAt: at + 5 }),
      worker('w_fail', 'Search', { status: 'failed', failure: 'container stopped', createdAt: at + 4 }),
      worker('w_run', 'Data', { status: 'working', kind: 'on-its-own', createdAt: at + 3 }),
      worker('w_line', 'Docs', { status: 'queued', createdAt: at + 6 }),
      worker('w_back', 'Footer', { status: 'handed-back', handbackCommits: ['a1 one', 'b2 two'], handbackFiles: ['x.ts'], createdAt: at + 2 }),
    ],
  }

  it('opens on the features list, and its arrow goes down to the feature’s page from worker.list: the Lead card, needs-you rows, the Working shelf with queued inside, Done folded', async () => {
    render(<Page />, { wrapper: server(mixed).Wrapper })
    await within(column()).findByText('said in th_main')
    // Opening the feature keeps the list (clicking-a-feature-opens-its-lead decision 1).
    expect(featurePage()).toBeNull()
    expect(within(sidebar()).getAllByRole('button', { name: /^Demo/ }).length).toBeGreaterThan(0)
    // The arrow counts the workers in play: two need you, one works, one queued.
    expect((await arrow()).textContent).toBe('4')
    await down()
    await waitFor(() => expect(lane('Needs you')).toEqual(['Header', 'Search']))
    expect(within(featurePage()!).getByRole('heading', { name: 'Demo' })).toBeTruthy()
    expect(within(featurePage()!).getByRole('button', { name: 'Back to the features' })).toBeTruthy()
    expect(within(featurePage()!).getByRole('button', { name: 'New worker' })).toBeTruthy()
    expect(leadCard().getAttribute('aria-current')).toBe('page')
    // Working ones first, then the queued in line.
    expect(lane('Working')).toEqual(['Data', 'Docs'])
    // Folded: its count shows, its rows do not.
    expect(lane('Done')).toEqual([])
    openDone()
    expect(lane('Done')).toEqual(['Footer', 'An old side thread'])
    expect(within(featurePage()!).getByText('Old side chat')).toBeTruthy()
    // The features list is not drawn while the page is.
    expect(within(sidebar()).queryByRole('region', { name: 'Epics' })).toBeNull()
  })

  it('goes back to the features list leaving the chat in front unchanged, and the feature’s row brings its lead back without going down', async () => {
    render(<Page />, { wrapper: server(mixed).Wrapper })
    await down()
    await waitFor(() => expect(lane('Needs you')).toHaveLength(2))
    pickWorker('Header')
    expect(await within(column()).findByText('said in w_ask')).toBeTruthy()

    fireEvent.click(within(featurePage()!).getByRole('button', { name: 'Back to the features' }))
    expect(featurePage()).toBeNull()
    expect(within(sidebar()).getByRole('region', { name: 'Epics' })).toBeTruthy()
    expect(within(column()).getByText('said in w_ask')).toBeTruthy()
    expect(threadName().textContent).toBe('Header')

    // The open feature's row brings its lead to the front and the list stays (decisions 1, 3).
    fireEvent.click(within(sidebar()).getAllByRole('button', { name: /^Demo/ })[0]!)
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    expect(featurePage()).toBeNull()
  })

  it('lights the amber dot on a worker that needs the human, and red on a failed one', async () => {
    render(<Page />, { wrapper: server(mixed).Wrapper })
    await down()
    await waitFor(() => expect(lane('Needs you')).toHaveLength(2))
    const row = (label: string) => within(featurePage()!).getAllByRole('button').find((b) => b.title.startsWith(`${label} — `))!
    expect(row('Header').innerHTML).toContain('bg-warning')
    expect(row('Search').innerHTML).toContain('bg-danger')
    expect(row('Data').innerHTML).not.toContain('bg-warning')
  })

  it('keeps a picked worker in the address, and a reload reopens it on the features list', async () => {
    window.history.replaceState(null, '', '/p/proj_1/f/login')
    render(<Page />, { wrapper: server(mixed).Wrapper })
    await down()
    await waitFor(() => expect(lane('Working')).toHaveLength(2))
    pickWorker('Data')
    await waitFor(() => expect(window.location.search).toBe('?thread=w_run'))

    cleanup()
    render(<Page />, { wrapper: server(mixed).Wrapper })
    expect(await within(column()).findByText('said in w_run')).toBeTruthy()
    expect(threadName().textContent).toBe('Data')
    // Only the arrow goes down (decision 3).
    expect(featurePage()).toBeNull()
  })

  it('moving to another feature leaves the open worker behind: the new page shows its own', async () => {
    const lists: Record<string, ThreadEntry[]> = {
      feat_a: [thread('th_a', 'Chat of A', 'main'), thread('w_a', 'A worker of A', 'worker')],
      feat_b: [thread('th_b', 'Chat of B', 'main')],
    }
    const api = server({ extra: { 'thread.list': ({ featureId }: { featureId: string }) => lists[featureId] } })
    function Shell({ slug }: { slug: string }) {
      useHistorySync({ kind: 'feature', projectId: 'proj_1', featureSlug: slug }, () => {})
      return <Page key={slug} featureId={slug} />
    }
    window.history.replaceState(null, '', '/p/proj_1/f/feat_a?thread=w_a')
    const { rerender } = render(<Shell slug="feat_a" />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in w_a')

    rerender(<Shell slug="feat_b" />)
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/p/proj_1/f/feat_b?thread=th_b'))
    expect(threadName().textContent).toBe('Chat of B')
  })

  it('starts an unassigned worker with the "+" and opens its chat on its assignment card', async () => {
    const api = server({ threads: [lead, thread('w_run', 'Data', 'worker')], workers: [worker('w_run', 'Data', { status: 'working' })] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await down()
    fireEvent.click(within(featurePage()!).getByRole('button', { name: 'New worker' }))
    expect(await within(column()).findByText('said in th_new')).toBeTruthy()
    expect(api.inputs('worker.startUnassigned')).toEqual([{ featureId: 'feat_1' }])
    expect(api.inputs('thread.new')).toEqual([])
    const card = await within(column()).findByRole('region', { name: 'Assignment: New worker' })
    expect(card.textContent).toContain('Started by you')
    expect(within(column()).getByText('Sandbox · its own branch off feature/demo')).toBeTruthy()
    expect(within(column()).queryByText(/Feature worktree/)).toBeNull()
  })

  it('shows a worker’s pinned assignment, Open preview while it has one, and Hand back, which calls worker.handBack', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const api = server({
      threads: mixed.threads,
      workers: [worker('w_ask', 'Header', { previewPath: '/__runcastle/open/worker/w_ask', previewPort: 41001, devServer: true })],
    })
    render(<Page />, { wrapper: api.Wrapper })
    await down()
    await waitFor(() => expect(lane('Needs you')).toEqual(['Header']))
    pickWorker('Header')
    const card = await within(column()).findByRole('region', { name: 'Assignment: Header' })
    expect(card.textContent).toContain('Build Header')
    expect(card.textContent).toContain('The human is happy')
    expect(card.textContent).toContain('Started by the lead')
    expect(within(header()).getByRole('status').textContent).toContain('Needs you')

    fireEvent.click(within(header()).getByRole('button', { name: 'Open preview' }))
    expect(open).toHaveBeenCalledWith(`${window.location.protocol}//${window.location.hostname}:4514/__runcastle/open/worker/w_ask`, '_blank', 'noopener')
    fireEvent.click(within(header()).getByRole('button', { name: 'Hand back' }))
    await waitFor(() => expect(api.inputs('worker.handBack')).toEqual([{ workerId: 'w_ask' }]))
    open.mockRestore()
  })

  it('offers no Open preview without a preview, and no Hand back once a worker has handed back', async () => {
    render(<Page />, { wrapper: server(mixed).Wrapper })
    await down()
    await waitFor(() => expect(lane('Needs you')).toHaveLength(2))
    openDone()
    pickWorker('Footer')
    await within(column()).findByText('said in w_back')
    await waitFor(() => expect(within(header()).getByRole('status').textContent).toContain('Handed back'))
    expect(within(header()).queryByRole('button', { name: 'Open preview' })).toBeNull()
    expect(within(header()).queryByRole('button', { name: 'Hand back' })).toBeNull()
    expect(within(column()).getByText(/Handed back to the lead · 2 commits · 1 file/)).toBeTruthy()
  })

  it('opens an old side chat as a read-only transcript: no composer, the old-side-chat note', async () => {
    const api = server(mixed)
    render(<Page />, { wrapper: api.Wrapper })
    await down()
    await waitFor(() => expect(lane('Needs you')).toHaveLength(2))
    openDone()
    pickWorker('An old side thread')
    expect(await within(column()).findByText('said in th_old')).toBeTruthy()
    expect(within(column()).getByText('Old side chat — read-only')).toBeTruthy()
    expect(within(column()).queryByLabelText('Message')).toBeNull()
    expect(within(header()).getByRole('status').textContent).toContain('Old side chat · read-only')
  })

  it('renames the lead’s chat from the open feature row’s menu through thread.rename', async () => {
    const list = [lead]
    const api = server({
      extra: {
        'thread.list': () => [...list],
        'thread.rename': ({ threadId, title }: { threadId: string; title: string }) => {
          list[0] = { ...list[0]!, id: threadId, title }
          return { ok: true }
        },
      },
    })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    // No workers, so no arrow and no Lead card: the row's own "…" holds it (clicking-a-feature-opens-its-lead decision 11).
    expect(within(sidebar()).queryByRole('button', { name: /^Workers/ })).toBeNull()
    openMenu(within(sidebar()).getAllByRole('button', { name: 'Feature actions' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename the lead’s chat…' }))
    const field = screen.getByRole('textbox', { name: 'Chat name' })
    fireEvent.change(field, { target: { value: 'Coupon expiry' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(api.inputs('thread.rename')).toEqual([{ threadId: 'th_main', title: 'Coupon expiry' }]))
    await waitFor(() => expect(threadName().textContent).toBe('Coupon expiry'))
  })

  it('offers no Rename or Export of the lead’s chat while nobody has started it', async () => {
    render(<Page worked />, { wrapper: server({ threads: [] }).Wrapper })
    await waitFor(() => expect(within(sidebar()).getAllByRole('button', { name: 'Feature actions' }).length).toBeGreaterThan(0))
    openMenu(within(sidebar()).getAllByRole('button', { name: 'Feature actions' })[0]!)
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /lead’s chat/ })).toBeNull()
  })

  it('counts a click on the open feature’s row, from the list, as opening it while its chat has no thread', async () => {
    const onSelect = vi.fn()
    render(<Page worked onSelect={onSelect} />, { wrapper: server({ threads: [] }).Wrapper })
    await waitFor(() => expect(within(sidebar()).getAllByRole('button', { name: /^Demo/ }).length).toBeGreaterThan(0))
    fireEvent.click(within(sidebar()).getAllByRole('button', { name: /^Demo/ })[0]!)
    expect(onSelect).toHaveBeenCalledWith('feat_1')
  })

  it('shows a feature chat nobody started as an empty thread, and its first Send starts it', async () => {
    const api = server({ threads: [] })
    render(<Page worked />, { wrapper: api.Wrapper })
    // named "New chat" until something is said in it, never by its kind (decision 14)
    expect(threadName().textContent).toBe('New chat')
    expect(within(column()).getByText('New chat')).toBeTruthy()
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(within(column()).getByText('Plan the export')).toBeTruthy()
  })

  it('ignores a ?thread= the feature does not hold, drops it from the address, and sends to its own thread', async () => {
    window.history.replaceState(null, '', '/p/proj_1/f/login?thread=th_elsewhere')
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe('?thread=th_main'))
    expect(api.inputs('thread.events').some((i) => (i as { threadId: string }).threadId === 'th_elsewhere')).toBe(false)
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: 'Which feature is this?' } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_main', text: 'Which feature is this?' }]))
  })

  it('moving to another feature in the app drops ?thread= from the address at once', async () => {
    const lists: Record<string, ThreadEntry[]> = {
      feat_a: [thread('th_a', 'Chat of A', 'main'), thread('w_a', 'A worker of A', 'worker')],
      feat_b: [thread('th_b', 'Chat of B', 'main')],
    }
    const b = later<ThreadEntry[]>()
    const api = server({ extra: { 'thread.list': ({ featureId }: { featureId: string }) => (featureId === 'feat_b' ? b.promise : lists[featureId]) } })
    function Shell({ slug }: { slug: string }) {
      useHistorySync({ kind: 'feature', projectId: 'proj_1', featureSlug: slug }, () => {})
      return <Page key={slug} featureId={slug} />
    }
    window.history.replaceState(null, '', '/p/proj_1/f/feat_a?thread=w_a')
    const { rerender } = render(<Shell slug="feat_a" />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in w_a')

    rerender(<Shell slug="feat_b" />)
    await tick()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/p/proj_1/f/feat_b')
    await act(async () => b.resolve(lists.feat_b!))
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
  })

  // No test renders the whole feature page, so its `start` is read from source:
  // the launch holds its opening as the chat asks, on the pick Start carries (feature-chat-start.test.tsx).
  it('starts the feature chat with its opening held as the chat asks', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/components/Workspace.tsx'), 'utf8')
    expect(source).toMatch(/startChat\.mutateAsync\(\{ featureId, kind: 'chat', holdOpening, \.\.\.pick \}\)/)
  })
})


/** A thread link, loaded or pasted, while the feature's thread list answers late (ticket 29). */
describe('a thread’s link', () => {
  const lists: Record<string, ThreadEntry[]> = {
    feat_a: [thread('th_a', 'Chat of A', 'main'), thread('th_a_side', 'A worker of A', 'worker')],
    feat_b: [thread('th_b', 'Chat of B', 'main')],
  }
  const SIDE_LINK = '/p/proj_1/f/feat_a/chat?thread=th_a_side'
  const send = (text: string): void => {
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: text } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
  }

  it('loaded fresh shows the worker once the list answers, and a send goes to it; until then nothing can be sent', async () => {
    const a = later<ThreadEntry[]>()
    const api = server({ extra: { 'thread.list': () => a.promise } })
    window.history.replaceState(null, '', SIDE_LINK)
    render(<Page featureId="feat_a" />, { wrapper: api.Wrapper })

    // Pending: neither the main thread nor a composer, and the link stays in the address.
    expect(within(column()).getByText('Opening the chat…')).toBeTruthy()
    await tick()
    expect(within(column()).queryByLabelText('Message')).toBeNull()
    expect(api.inputs('thread.events')).toEqual([])
    expect(window.location.search).toBe('?thread=th_a_side')

    await act(async () => a.resolve(lists.feat_a!))
    expect(await within(column()).findByText('said in th_a_side')).toBeTruthy()
    send('Still on the side?')
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_a_side', text: 'Still on the side?' }]))
    expect(window.location.search).toBe('?thread=th_a_side')
  })

  it('pasted while on another feature: the stored page shown before the landing leaves it for the page it names', async () => {
    const api = server({ extra: { 'thread.list': ({ featureId }: { featureId: string }) => lists[featureId] } })
    /** The shell: before it lands it shows the feature it stored, then the one the address names. */
    function Shell({ slug, landed }: { slug: string; landed: boolean }) {
      return (
        <AddressSettled.Provider value={landed}>
          <Page key={slug} featureId={slug} />
        </AddressSettled.Provider>
      )
    }
    window.history.replaceState(null, '', SIDE_LINK)
    const { rerender } = render(<Shell slug="feat_b" landed={false} />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_b')
    await tick()
    expect(window.location.search).toBe('?thread=th_a_side')

    rerender(<Shell slug="feat_a" landed />)
    expect(await within(column()).findByText('said in th_a_side')).toBeTruthy()
    send('Which thread is this?')
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_a_side', text: 'Which thread is this?' }]))
    expect(window.location.search).toBe('?thread=th_a_side')
  })

  it('naming another feature’s thread is dropped once the list answers, and the page shows its own', async () => {
    const b = later<ThreadEntry[]>()
    const api = server({ extra: { 'thread.list': () => b.promise } })
    window.history.replaceState(null, '', '/p/proj_1/f/feat_b/chat?thread=th_a_side')
    render(<Page featureId="feat_b" />, { wrapper: api.Wrapper })
    expect(within(column()).getByText('Opening the chat…')).toBeTruthy()

    await act(async () => b.resolve(lists.feat_b!))
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe('?thread=th_b'))
    expect(api.inputs('thread.events').some((i) => (i as { threadId: string }).threadId === 'th_a_side')).toBe(false)
  })
})

describe('the Scenarios worker in the column (drive-chats-become-workers decision 11)', () => {
  /** The feature's Scenarios worker, as `worker.list` serves it once a drive button started it. */
  const scenarios = worker('th_scn', 'Scenarios', {
    kind: 'scenario',
    purpose: 'Writes and fixes this drive’s scenarios',
    goal: null,
    doneWhen: null,
    startedBy: 'human',
    container: null,
    branch: null,
  })

  it('brings the Scenarios worker New scenario opens to the front, named by its label', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    expect(await within(column()).findByText('said in th_scn')).toBeTruthy()
    expect(threadName().textContent).toBe('Scenarios')
    // The drive keeps the panel: no chat is docked inside it.
    expect(within(document.querySelector('[data-panel]') as HTMLElement).queryByLabelText('Message')).toBeNull()
  })

  it('wears the worker header and assignment card: Started by you, no goal, no Open preview, the branch it commits on', async () => {
    const api = server({ workers: [scenarios] })
    render(<Page scenario={FAILED} />, { wrapper: api.Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    const card = await within(column()).findByRole('region', { name: 'Assignment: Scenarios' })
    expect(card.textContent).toContain('Started by you')
    expect(card.textContent).not.toContain('Goal')
    await waitFor(() => expect(within(header()).getByRole('status').textContent).toContain('Needs you'))
    expect(within(header()).getByRole('button', { name: 'Hand back' })).toBeTruthy()
    expect(within(header()).queryByRole('button', { name: 'Open preview' })).toBeNull()
    expect(within(column()).getByText('Your checkout · commits on feature/demo')).toBeTruthy()
  })

  it('says why Fix it was refused where the button is, while the Fix-drive worker works (decision 13)', async () => {
    const api = server({
      extra: {
        'feature.openScenarioChat': () => {
          throw new Error('Fix drive is working — wait for it to finish')
        },
      },
    })
    render(<Page scenario={FAILED} />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    const panel = document.querySelector('[data-panel]') as HTMLElement
    expect((await within(panel).findByText('Fix drive is working — wait for it to finish')).closest('[role="alert"]')).toBeTruthy()
    expect(within(column()).getByText('said in th_main')).toBeTruthy()
  })

  it('lists it in the worker lanes, and hands the column back when its errand is closed', async () => {
    const api = server({ workers: [scenarios] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    await within(column()).findByText('said in th_scn')
    await down()
    await waitFor(() => expect(lane('Needs you')).toEqual(['Scenarios']))
    expect(threadList()).toBeNull()
    const row = within(featurePage()!).getByTitle(/^Scenarios — /).parentElement as HTMLElement
    openMenu(within(row).getByRole('button', { name: 'Worker actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close the scenario chat' }))
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()

    newScenario()
    expect(await within(column()).findByText('said in th_scn')).toBeTruthy()
  })

  it('leaves the main chat in front for a scenario chat the live drive already has', async () => {
    const api = server()
    render(<Page driveSessionId="th_live" />, { wrapper: api.Wrapper })
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
  })
})

describe('the feature header’s status and its sidebar row (decision 15)', () => {
  /**
   * The header's status line as the feature page derives it (the main chat's
   * thread state, the row's stale turn bit beside it, `feature.get`'s
   * `need`), above the feature's sidebar row from `feature.list`.
   */
  function HeaderAndRow({ wokenAt }: { wokenAt?: number }) {
    const column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
    const full = trpc.feature.get.useQuery({ id: 'feat_1' }).data
    const row = trpc.feature.list.useQuery({ projectId: 'proj_1' }).data?.[0]
    if (!full || !row) return null
    const status = featureStatus({
      feature: full.feature,
      need: full.need,
      workersWorking: 0,
      agentWorking: mainChatWorking(column.mainState, { awaitingInput: false }),
      agentStateKnown: column.mainState !== undefined,
      driving: false,
      selfPlanning: false,
      ...(wokenAt !== undefined ? { leadWake: { pendingSince: wokenAt } } : {}),
      now: at,
    })
    return (
      <>
        <FeatureStatusLine status={status} />
        <div data-row="">
          <SidebarFeatureRow f={row} active={false} onSelect={() => {}} actions={[]} />
        </div>
      </>
    )
  }

  /**
   * A feature whose main chat the test moves: the thread's state and what the
   * server says it needs. `move` changes it and refetches every read, as a live
   * signal's resync does (lib/live.ts).
   */
  function feature(start: { state: ThreadEntry['state']; need: FeatureNeed | null }) {
    let now = start
    const api = server({
      extra: {
        'thread.list': () => [thread('th_main', 'Feature chat', 'main', { state: now.state })],
        'feature.get': () => ({ ...fixture({ id: 'feat_1' }), need: now.need }),
        'feature.list': () => [
          listItem({
            id: 'feat_1',
            liveSession: { status: 'live', awaitingInput: now.state !== 'working' },
            need: now.need,
          }),
        ],
      },
    })
    const move = async (next: typeof start) => {
      now = next
      await act(() => api.queryClient.invalidateQueries())
    }
    return { api, move }
  }

  const header = () => screen.getByRole('status').textContent ?? ''
  const row = () => document.querySelector('[data-row]') as HTMLElement
  const answer: FeatureNeed = { kind: 'answer', words: 'Needs your answer', held: false, since: 1 }
  /** Both places say the feature waits on the human's answer, the row with its amber dot. */
  const bothWait = async () =>
    waitFor(() => {
      expect(header()).toBe('Needs your answer')
      expect(row().textContent).toContain('Needs your answer')
      expect(row().innerHTML).toContain('bg-warning')
    })
  const bothWork = async () =>
    waitFor(() => {
      expect(header()).toContain('Working')
      expect(row().textContent).toContain('Agent working')
      expect(row().innerHTML).not.toContain('bg-warning')
    })

  it('waits on the human in both once a runcastle-sent wake’s turn ends, even inside the wake’s grace', async () => {
    const { api, move } = feature({ state: 'working', need: null })
    // The orchestrator's message went out five seconds ago, well inside its grace.
    render(<HeaderAndRow wokenAt={at - 5_000} />, { wrapper: api.Wrapper })
    await bothWork()

    await move({ state: 'idle', need: answer })
    await bothWait()
  })

  it('waits on the human in both after an ordinary lead reply, and a human message clears both', async () => {
    const { api, move } = feature({ state: 'working', need: null })
    render(<HeaderAndRow />, { wrapper: api.Wrapper })
    await bothWork()

    await move({ state: 'idle', need: answer })
    await bothWait()

    // The message is logged while the idle-stopped agent comes back: nobody waits on anybody.
    await move({ state: 'idle', need: null })
    await waitFor(() => {
      expect(header()).toBe('Talking with you')
      expect(row().textContent).toContain('In progress')
      expect(row().innerHTML).not.toContain('bg-warning')
    })

    await move({ state: 'working', need: null })
    await bothWork()
  })

  it('says the same need in both, with its own words', async () => {
    const stopped: FeatureNeed = { kind: 'stopped', words: 'Stopped · you stopped it', why: 'you stopped it', held: false, since: 1 }
    const { api } = feature({ state: 'idle', need: stopped })
    render(<HeaderAndRow />, { wrapper: api.Wrapper })
    await waitFor(() => {
      expect(header()).toBe('Stopped· you stopped it')
      expect(row().textContent).toContain('Stopped · you stopped it')
      expect(row().innerHTML).toContain('bg-warning')
    })
  })
})

describe('a Select area crop', () => {
  it('brings the main chat to the front with the crop in its composer', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'A worker', 'worker')], workers: [worker('th_old', 'A worker', { status: 'working' })] })
    URL.createObjectURL = vi.fn(() => 'blob:crop')
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await down()
    await waitFor(() => expect(lane('Working')).toEqual(['A worker']))
    pickWorker('A worker')
    await within(column()).findByText('said in th_old')

    await act(async () => {
      putInInbox(mainChatInbox('feat_1'), [new File(['png'], 'selection.png', { type: 'image/png' })])
    })

    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    expect(within(column()).getByRole('img', { name: 'selection.png' })).toBeTruthy()
  })
})
