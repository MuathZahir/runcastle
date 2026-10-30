// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveScenario, ThreadEntry, ThreadEvent } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { fakeTrpc, type FakeHandlers } from './fake-trpc'
import { full as fixture, listItem } from './fixtures'
import { openMenu, openList } from './floating'

/**
 * The feature page's chat column (chat-as-web-components decision 7) and its
 * threads in the sidebar (threads-in-the-sidebar): the sidebar lists every
 * thread of the open feature from `thread.list` under its row, finished ones
 * included, and the column shows the one in front through ThreadColumn; the
 * header names it. A drive errand brings its scenario chat to the front and
 * closing it hands the column back; the row's "+" makes a side thread and
 * selects it.
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

function server({ threads = [thread('th_main', 'Feature chat', 'main')], extra = {} }: { threads?: ThreadEntry[]; extra?: FakeHandlers } = {}) {
  const list = [...threads]
  return fakeTrpc({
    'thread.list': () => list,
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': ({ threadId }: { threadId: string }) => ({ events: logOf(threadId) }),
    'thread.new': () => {
      list.push(thread('th_side', 'New chat', 'side'))
      return { threadId: 'th_side' }
    },
    'thread.send': () => ({ promptId: 'p_sent' }),
    'feature.launchSession': () => ({ sessionId: 'th_started' }),
    'feature.driveScenarios': () => ({ runnerConfigured: true, scenarios: [] }),
    'feature.openScenarioChat': () => ({ sessionId: 'th_scn' }),
    // The sidebar's own read: the open feature's row, in its lane.
    'feature.list': () => ['feat_1', 'feat_a', 'feat_b'].map((id) => listItem({ id, slug: id })),
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

type PageProps = { featureId?: string; driveSessionId?: string; scenario?: DriveScenario; sessions?: FeatureFull['sessions']; worked?: boolean }

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
          onSelect={() => {}}
          onSelectProject={() => {}}
          onNewChat={() => {}}
          onDraft={() => {}}
          onOpenPreparation={() => {}}
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
  return (
    <ScenarioChatContext.Provider value={column.scenario}>
      <header data-thread-name="">{column.threads.find((t) => t.id === column.current)?.title}</header>
      <div data-column="">
        <FeatureChat
          full={full}
          column={column}
          events={[]}
          hidden={false}
          start={async () => 'th_started'}
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
/** The open feature's thread list in the sidebar; null while it lists none (decision 2). */
const threadList = (): HTMLElement | null => within(sidebar()).queryByRole('list', { name: 'Threads' })
/** The thread rows the sidebar lists under the open feature, by title, in order. */
const options = (): string[] =>
  threadList() ? within(threadList()!).getAllByRole('button').flatMap((b) => (b.title ? [b.title] : [])) : []
/** A thread's row in the sidebar's list. */
const threadRow = (title: string): HTMLElement => within(threadList()!).getByTitle(title).parentElement as HTMLElement
const pick = (title: string): void => {
  fireEvent.click(within(threadList()!).getByTitle(title))
}
/** The open feature row's "+". */
const newThread = (): void => {
  fireEvent.click(within(sidebar()).getByRole('button', { name: 'New thread' }))
}
/** An item of a thread row's "…" menu. */
const threadAction = (title: string, name: string): void => {
  openMenu(within(threadRow(title)).getByRole('button', { name: 'Thread actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}
/** The open feature row's own "…" menu, open. */
const featureMenu = (): void => {
  const open = sidebar().querySelector('button[aria-current="page"]')?.parentElement as HTMLElement
  openMenu(within(open).getByRole('button', { name: 'Feature actions' }))
}
const newScenario = (): void => {
  openList(screen.getByRole('button', { name: /Blank app/ }))
  fireEvent.click(screen.getByRole('option', { name: 'New scenario' }))
}

describe('the open feature’s threads in the sidebar', () => {
  it('lists every thread from thread.list, finished ones included, with the main chat in front', async () => {
    const api = server({
      threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side', { updatedAt: at - 86_400_000 })],
    })
    render(<Page />, { wrapper: api.Wrapper })
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    await waitFor(() => expect(options()).toEqual(['Feature chat', 'An old side thread']))
    expect(threadName().textContent).toBe('Feature chat')
  })

  it('switches the column to a picked thread', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await waitFor(() => expect(options()).toHaveLength(2))
    pick('An old side thread')
    expect(await within(column()).findByText('said in th_old')).toBeTruthy()
    expect(within(column()).queryByText('said in th_main')).toBeNull()
  })

  it('keeps the picked thread in the address, and a reload reopens it', async () => {
    window.history.replaceState(null, '', '/p/proj_1/f/login')
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await waitFor(() => expect(options()).toHaveLength(2))
    pick('An old side thread')
    await waitFor(() => expect(window.location.search).toBe('?thread=th_old'))
    expect(window.location.pathname).toBe('/p/proj_1/f/login')

    cleanup()
    render(<Page />, { wrapper: server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')] }).Wrapper })
    expect(await within(column()).findByText('said in th_old')).toBeTruthy()
    expect(threadName().textContent).toBe('An old side thread')
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

  it('moving to another feature leaves the open thread behind: the new page shows its own', async () => {
    const lists: Record<string, ThreadEntry[]> = {
      feat_a: [thread('th_a', 'Chat of A', 'main'), thread('th_a_side', 'A side thread of A', 'side')],
      feat_b: [thread('th_b', 'Chat of B', 'main')],
    }
    const api = server({ extra: { 'thread.list': ({ featureId }: { featureId: string }) => lists[featureId] } })
    /** The shell: the address follows the feature, and each feature's page is its own (keyed, as ProjectShell keys it). */
    function Shell({ slug }: { slug: string }) {
      useHistorySync({ kind: 'feature', projectId: 'proj_1', featureSlug: slug }, () => {})
      return <Page key={slug} featureId={slug} />
    }
    window.history.replaceState(null, '', '/p/proj_1/f/feat_a')
    const { rerender } = render(<Shell slug="feat_a" />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_a')
    await waitFor(() => expect(options()).toHaveLength(2))
    pick('A side thread of A')
    await waitFor(() => expect(window.location.search).toBe('?thread=th_a_side'))

    rerender(<Shell slug="feat_b" />)
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
    expect(within(column()).queryByText('said in th_a_side')).toBeNull()
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/p/proj_1/f/feat_b?thread=th_b'))
    expect(threadName().textContent).toBe('Chat of B')
    // Feature B has only its main chat: the sidebar lists nothing under it (decision 2).
    expect(threadList()).toBeNull()
  })

  it('moving to another feature in the app drops ?thread= from the address at once', async () => {
    const lists: Record<string, ThreadEntry[]> = {
      feat_a: [thread('th_a', 'Chat of A', 'main'), thread('th_a_side', 'A side thread of A', 'side')],
      feat_b: [thread('th_b', 'Chat of B', 'main')],
    }
    const b = later<ThreadEntry[]>()
    const api = server({ extra: { 'thread.list': ({ featureId }: { featureId: string }) => (featureId === 'feat_b' ? b.promise : lists[featureId]) } })
    function Shell({ slug }: { slug: string }) {
      useHistorySync({ kind: 'feature', projectId: 'proj_1', featureSlug: slug }, () => {})
      return <Page key={slug} featureId={slug} />
    }
    window.history.replaceState(null, '', '/p/proj_1/f/feat_a?thread=th_a_side')
    const { rerender } = render(<Shell slug="feat_a" />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_a_side')

    rerender(<Shell slug="feat_b" />)
    await tick()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/p/proj_1/f/feat_b')
    await act(async () => b.resolve(lists.feat_b!))
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
  })

  it('makes a side thread with the row’s "+" and selects it', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newThread()
    expect(await within(column()).findByText('said in th_side')).toBeTruthy()
    expect(api.inputs('thread.new')).toEqual([{ featureId: 'feat_1' }])
  })

  // decision 14: a new thread opens whatever else is running.
  it('starts a side thread while the main chat works, and lists both with their names and states', async () => {
    const api = server({ threads: [thread('th_main', 'Fix the login page', 'main', { state: 'working' })] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newThread()
    expect(await within(column()).findByText('said in th_side')).toBeTruthy()

    // The main chat first, then the newest started (decision 3).
    await waitFor(() => expect(options()).toEqual(['Fix the login page', 'New chat']))
    expect(threadRow('Fix the login page').querySelector('[data-progress]')).not.toBeNull()
    expect(threadRow('New chat').textContent).toMatch(/New chat(\d+[mhd]|now)$/)
  })

  it('marks a thread waiting on the human with the amber dot', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_ask', 'Asking', 'side', { state: 'waiting' })] })
    render(<Page />, { wrapper: api.Wrapper })
    await waitFor(() => expect(options()).toHaveLength(2))
    expect(within(threadRow('Asking')).getByLabelText('Waiting for you')).toBeTruthy()
    expect(within(threadRow('Feature chat')).queryByLabelText('Waiting for you')).toBeNull()
  })

  it('folds the open feature’s threads away with its chevron, and brings them back', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')] })
    render(<Page />, { wrapper: api.Wrapper })
    await waitFor(() => expect(options()).toHaveLength(2))
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Hide threads' }))
    expect(threadList()).toBeNull()
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Show threads' }))
    expect(options()).toHaveLength(2)
  })

  it('renames a thread from its row’s menu through thread.rename, and the list and header show the new title', async () => {
    const list = [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')]
    const api = server({
      threads: list,
      extra: {
        // A fresh array, as a real response is: the cache sees the change.
        'thread.list': () => [...list],
        'thread.rename': ({ threadId, title }: { threadId: string; title: string }) => {
          list[0] = { ...list[0]!, id: threadId, title }
          return { ok: true }
        },
      },
    })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await waitFor(() => expect(options()).toHaveLength(2))
    threadAction('Feature chat', 'Rename…')
    const field = screen.getByRole('textbox', { name: 'Thread name' })
    fireEvent.change(field, { target: { value: 'Coupon expiry' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(api.inputs('thread.rename')).toEqual([{ threadId: 'th_main', title: 'Coupon expiry' }]))
    await waitFor(() => expect(options()).toEqual(['Coupon expiry', 'An old side thread']))
    expect(threadName().textContent).toBe('Coupon expiry')
  })

  it('exports a feature’s only chat from the feature row’s menu as a downloaded <title>.md', async () => {
    const api = server({ extra: { 'thread.export': () => ({ markdown: '# Feature chat\n' }) } })
    URL.createObjectURL = vi.fn(() => 'blob:md')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    // One chat lists nothing under the row (decision 2): its menu carries the chat's own.
    expect(threadList()).toBeNull()
    await waitFor(() => {
      featureMenu()
      expect(screen.getByRole('menuitem', { name: 'Export the chat as Markdown' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export the chat as Markdown' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(api.inputs('thread.export')).toEqual([{ threadId: 'th_main' }])
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Feature chat.md')
    click.mockRestore()
  })

  it('offers no Rename or Export for a feature chat nobody has started', async () => {
    const api = server({ threads: [] })
    render(<Page worked />, { wrapper: api.Wrapper })
    await waitFor(() => expect(within(sidebar()).getByRole('button', { name: 'New thread' })).toBeTruthy())
    featureMenu()
    expect(screen.queryByRole('menuitem', { name: 'Rename the chat…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Export the chat as Markdown' })).toBeNull()
  })

  it('shows a feature chat nobody started as an empty thread, and its first Send starts it', async () => {
    const api = server({ threads: [] })
    render(<Page worked />, { wrapper: api.Wrapper })
    // named "New chat" until something is said in it, never by its kind (decision 14)
    expect(threadName().textContent).toBe('New chat')
    expect(within(column()).getByText('New thread')).toBeTruthy()
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(within(column()).getByText('Plan the export')).toBeTruthy()
  })

  // No test renders the whole feature page, so its `start` is read from source:
  // the launch holds its opening as the chat asks (feature-chat-start.test.tsx).
  it('starts the feature chat with its opening held as the chat asks', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/components/Workspace.tsx'), 'utf8')
    expect(source).toMatch(/startChat\.mutateAsync\(\{ featureId, kind: 'chat', holdOpening \}\)/)
  })
})

/** A thread link, loaded or pasted, while the feature's thread list answers late (ticket 29). */
describe('a thread’s link', () => {
  const lists: Record<string, ThreadEntry[]> = {
    feat_a: [thread('th_a', 'Chat of A', 'main'), thread('th_a_side', 'A side thread of A', 'side')],
    feat_b: [thread('th_b', 'Chat of B', 'main')],
  }
  const SIDE_LINK = '/p/proj_1/f/feat_a/chat?thread=th_a_side'
  const send = (text: string): void => {
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: text } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
  }

  it('loaded fresh shows the side thread once the list answers, and a send goes to it; until then nothing can be sent', async () => {
    const a = later<ThreadEntry[]>()
    const api = server({ extra: { 'thread.list': () => a.promise } })
    window.history.replaceState(null, '', SIDE_LINK)
    render(<Page featureId="feat_a" />, { wrapper: api.Wrapper })

    // Pending: neither the main thread nor a composer, and the link stays in the address.
    expect(within(column()).getByText('Opening the thread…')).toBeTruthy()
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
    expect(within(column()).getByText('Opening the thread…')).toBeTruthy()

    await act(async () => b.resolve(lists.feat_b!))
    expect(await within(column()).findByText('said in th_b')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe('?thread=th_b'))
    expect(api.inputs('thread.events').some((i) => (i as { threadId: string }).threadId === 'th_a_side')).toBe(false)
  })
})

describe('the scenario errand in the column', () => {
  it('brings the scenario chat an errand opens to the front, naming it by its errand', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    expect(await within(column()).findByText('said in th_scn')).toBeTruthy()
    expect(threadName().textContent).toBe('Scenario chat · New scenario')
    // The drive keeps the panel: no chat is docked inside it.
    expect(within(document.querySelector('[data-panel]') as HTMLElement).queryByLabelText('Message')).toBeNull()
  })

  it('names a Fix it errand by its scenario', async () => {
    const api = server()
    render(<Page scenario={FAILED} />, { wrapper: api.Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    await waitFor(() => expect(threadName().textContent).toBe('Scenario chat · Fix Expired coupon'))
  })

  it('hands the column back when the errand is closed, and New scenario brings it to the front again', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    await within(column()).findByText('said in th_scn')
    await waitFor(() => expect(options()).toContain('Scenario chat · New scenario'))
    threadAction('Scenario chat · New scenario', 'Close the scenario chat')
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
   * `leadAwaitsHuman`), above the feature's sidebar row from `feature.list`.
   */
  function HeaderAndRow({ wokenAt }: { wokenAt?: number }) {
    const column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
    const full = trpc.feature.get.useQuery({ id: 'feat_1' }).data
    const row = trpc.feature.list.useQuery({ projectId: 'proj_1' }).data?.[0]
    if (!full || !row) return null
    const status = featureStatus({
      feature: full.feature,
      rounds: [],
      declarations: [],
      agentWorking: mainChatWorking(column.mainState, { awaitingInput: false }),
      agentStateKnown: column.mainState !== undefined,
      leadAwaitsHuman: full.leadAwaitsHuman,
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
   * A feature whose main chat the test moves: the thread's state, whether the
   * lead's reply waits on the human, and a waiting reason. `move` changes it and
   * refetches every read, as a live signal's resync does (lib/live.ts).
   */
  function feature(start: { state: ThreadEntry['state']; replied: boolean; waitingReason?: string }) {
    let now = start
    const api = server({
      extra: {
        'thread.list': () => [thread('th_main', 'Feature chat', 'main', { state: now.state })],
        'feature.get': () => ({
          ...fixture({ id: 'feat_1', waitingReason: now.waitingReason ?? null }),
          leadAwaitsHuman: now.replied,
        }),
        'feature.list': () => [
          listItem({
            id: 'feat_1',
            waitingReason: now.waitingReason ?? null,
            liveSession: { status: 'live', awaitingInput: now.state !== 'working' },
            leadAwaitsHuman: now.replied,
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
  /** Both places say the feature waits on the human, the row with its amber dot. */
  const bothWait = async () =>
    waitFor(() => {
      expect(header()).toBe('Waiting for you')
      expect(row().textContent).toContain('Waiting on you')
      expect(row().innerHTML).toContain('bg-warning')
    })
  const bothWork = async () =>
    waitFor(() => {
      expect(header()).toContain('Working')
      expect(row().textContent).toContain('Agent working')
      expect(row().innerHTML).not.toContain('bg-warning')
    })

  it('waits on the human in both once a runcastle-sent wake’s turn ends, even inside the wake’s grace', async () => {
    const { api, move } = feature({ state: 'working', replied: false })
    // The orchestrator's message went out five seconds ago, well inside its grace.
    render(<HeaderAndRow wokenAt={at - 5_000} />, { wrapper: api.Wrapper })
    await bothWork()

    await move({ state: 'idle', replied: true })
    await bothWait()
  })

  it('waits on the human in both after an ordinary lead reply, and a human message clears both', async () => {
    const { api, move } = feature({ state: 'working', replied: false })
    render(<HeaderAndRow />, { wrapper: api.Wrapper })
    await bothWork()

    await move({ state: 'idle', replied: true })
    await bothWait()

    // The message is logged while the idle-stopped agent comes back: nobody waits on anybody.
    await move({ state: 'idle', replied: false })
    await waitFor(() => {
      expect(header()).toBe('Talking with you')
      expect(row().textContent).toContain('In progress')
      expect(row().innerHTML).not.toContain('bg-warning')
    })

    await move({ state: 'working', replied: false })
    await bothWork()
  })

  it('lets an explicit waiting reason speak in both, with its own words', async () => {
    const { api } = feature({ state: 'idle', replied: true, waitingReason: 'stopped' })
    render(<HeaderAndRow />, { wrapper: api.Wrapper })
    await waitFor(() => {
      expect(header()).toBe('Waiting for you· stopped')
      expect(row().textContent).toContain('Stopped')
      expect(row().innerHTML).toContain('bg-warning')
    })
  })
})

describe('a Select area crop', () => {
  it('brings the main chat to the front with the crop in its composer', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side')] })
    URL.createObjectURL = vi.fn(() => 'blob:crop')
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    await waitFor(() => expect(options()).toHaveLength(2))
    pick('An old side thread')
    await within(column()).findByText('said in th_old')

    await act(async () => {
      putInInbox(mainChatInbox('feat_1'), [new File(['png'], 'selection.png', { type: 'image/png' })])
    })

    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    expect(within(column()).getByRole('img', { name: 'selection.png' })).toBeTruthy()
  })
})
