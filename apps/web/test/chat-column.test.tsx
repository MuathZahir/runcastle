// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveScenario, ThreadEntry, ThreadEvent } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { fakeTrpc, type FakeHandlers } from './fake-trpc'
import { full as fixture } from './fixtures'
import { openMenu } from './floating'

/**
 * The feature page's chat column (chat-as-web-components decision 7): the
 * header's ThreadSwitcher lists every thread of the feature from `thread.list`,
 * finished ones included, and the column shows the one in front through
 * ThreadColumn. A drive errand brings its scenario chat to the front and
 * closing it hands the column back; New thread makes a side thread and selects
 * it; a thread waiting on the human that is not in view puts a dot on the
 * switcher.
 *
 * Tier 2: the switcher is a portalled menu. The seam is the column the page
 * assembles — its hook, the switcher, the chat and the drive that opens an
 * errand — on the app's real tRPC hooks; the server is faked by path.
 */

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ScenarioChatContext, ScenarioChatMenu } = await import('../src/components/chat/ScenarioChat')
const { ThreadSwitcher } = await import('../src/components/chat/thread/ThreadSwitcher')
const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { FeatureChat } = await import('../src/components/workspace/FeatureChat')
const { ScenarioDrive } = await import('../src/components/review/ScenarioDrive')
const { mainChatInbox, putInInbox } = await import('../src/lib/composer-inbox')
const { useThreadMenu } = await import('../src/lib/use-thread')
const { useHistorySync } = await import('../src/lib/use-history-sync')
const { featureStatus, mainChatWorking } = await import('../src/lib/feature-ui/status-line')
const { FeatureStatusLine } = await import('../src/components/workspace/FeatureStatusLine')

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
    ...extra,
  })
}

/** The feature page's header switcher and column beside its drive panel, as the page assembles them. */
function Page({ featureId = 'feat_1', driveSessionId, scenario, sessions = [] }: { featureId?: string; driveSessionId?: string; scenario?: DriveScenario; sessions?: FeatureFull['sessions'] }) {
  const column = useFeatureChatColumn({ featureId, sessions, driveSessionId })
  const threadMenu = useThreadMenu(column.inFront)
  const full = { ...fixture({ id: featureId }), sessions, tickets: [] } as FeatureFull
  return (
    <ScenarioChatContext.Provider value={column.scenario}>
      <header>
        <ThreadSwitcher threads={column.threads} current={column.current} onPick={column.pick} onNew={column.newThread} {...threadMenu}>
          {column.scenario.listed && column.inFront === column.scenario.sessionId && <ScenarioChatMenu chat={column.scenario} />}
        </ThreadSwitcher>
      </header>
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

const switcher = (): HTMLElement => screen.getByRole('button', { name: 'Thread' })
const column = (): HTMLElement => document.querySelector('[data-column]') as HTMLElement
/** The thread rows the switcher lists, by title. */
const options = (): string[] => {
  openMenu(switcher())
  const rows = screen.getAllByRole('menuitemradio').map((o) => o.querySelector('span span span')?.textContent ?? '')
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  return rows
}
const pick = (title: string): void => {
  openMenu(switcher())
  fireEvent.click(screen.getAllByRole('menuitemradio').find((o) => o.textContent?.includes(title)) as HTMLElement)
}
const menuAction = (name: string): void => {
  openMenu(switcher())
  fireEvent.click(screen.getByRole('menuitem', { name }))
}
const newScenario = (): void => {
  openMenu(screen.getByRole('button', { name: 'Scenario' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'New scenario' }))
}

describe('the feature page’s thread switcher', () => {
  it('lists every thread from thread.list, finished ones included, with the main chat in front', async () => {
    const api = server({
      threads: [thread('th_main', 'Feature chat', 'main'), thread('th_old', 'An old side thread', 'side', { updatedAt: at - 86_400_000 })],
    })
    render(<Page />, { wrapper: api.Wrapper })
    expect(await within(column()).findByText('said in th_main')).toBeTruthy()
    await waitFor(() => expect(options()).toEqual(['Feature chat', 'An old side thread']))
    expect(switcher().textContent).toContain('Feature chat')
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
    expect(switcher().textContent).toContain('An old side thread')
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
    expect(switcher().textContent).toContain('Chat of B')
  })

  it('makes a side thread with New thread and selects it', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    menuAction('New thread')
    expect(await within(column()).findByText('said in th_side')).toBeTruthy()
    expect(api.inputs('thread.new')).toEqual([{ featureId: 'feat_1' }])
  })

  // decision 14: a new thread opens whatever else is running.
  it('starts a side thread while the main chat works, and lists both with their names and states', async () => {
    const api = server({ threads: [thread('th_main', 'Fix the login page', 'main', { state: 'working' })] })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    menuAction('New thread')
    expect(await within(column()).findByText('said in th_side')).toBeTruthy()

    openMenu(switcher())
    await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(2))
    const rows = screen.getAllByRole('menuitemradio').map((o) => o.textContent ?? '')
    expect(rows.find((r) => r.includes('Fix the login page'))).toContain('working')
    expect(rows.find((r) => r.includes('New chat'))).toMatch(/New chat(\d+[mhd]|now)$/)
  })

  it('offers no End session', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    openMenu(switcher())
    expect(screen.queryByRole('menuitem', { name: 'End session' })).toBeNull()
  })

  it('puts a dot on the switcher while another thread waits on the human', async () => {
    const api = server({ threads: [thread('th_main', 'Feature chat', 'main'), thread('th_ask', 'Asking', 'side', { state: 'waiting' })] })
    render(<Page />, { wrapper: api.Wrapper })
    expect(await within(switcher()).findByLabelText('Another thread is waiting for you')).toBeTruthy()
    pick('Asking')
    await waitFor(() => expect(within(switcher()).queryByLabelText('Another thread is waiting for you')).toBeNull())
  })

  it('renames the thread in front through thread.rename, and the list shows the new title', async () => {
    const list = [thread('th_main', 'Feature chat', 'main')]
    const api = server({
      threads: list,
      extra: {
        'thread.list': () => list,
        'thread.rename': ({ threadId, title }: { threadId: string; title: string }) => {
          list[0] = { ...list[0], id: threadId, title }
          return { ok: true }
        },
      },
    })
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    menuAction('Rename…')
    const field = screen.getByRole('textbox', { name: 'Thread name' })
    fireEvent.change(field, { target: { value: 'Coupon expiry' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(api.inputs('thread.rename')).toEqual([{ threadId: 'th_main', title: 'Coupon expiry' }]))
    await waitFor(() => expect(switcher().textContent).toContain('Coupon expiry'))
  })

  it('exports the thread in front as a downloaded <title>.md from thread.export', async () => {
    const api = server({ extra: { 'thread.export': () => ({ markdown: '# Feature chat\n' }) } })
    URL.createObjectURL = vi.fn(() => 'blob:md')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    menuAction('Export as Markdown')
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(api.inputs('thread.export')).toEqual([{ threadId: 'th_main' }])
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Feature chat.md')
    click.mockRestore()
  })

  it('offers no Rename or Export for a feature chat nobody has started', async () => {
    const api = server({ threads: [] })
    render(<Page />, { wrapper: api.Wrapper })
    openMenu(switcher())
    expect(screen.getByRole('menuitem', { name: 'New thread' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Rename…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Export as Markdown' })).toBeNull()
  })

  it('shows a feature chat nobody started as an empty thread, and its first Send starts it', async () => {
    const api = server({ threads: [] })
    render(<Page />, { wrapper: api.Wrapper })
    // named "New chat" until something is said in it, never by its kind (decision 14)
    expect(switcher().textContent).toContain('New chat')
    expect(switcher().textContent).not.toContain('Feature chat')
    expect(within(column()).getByText('New thread')).toBeTruthy()
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(within(column()).getByText('Plan the export')).toBeTruthy()
  })

  // Decision 12. No test renders the whole feature page, so its `start` is read
  // from source: the launch holds its opening for the first message.
  it('starts the feature chat with its opening held for the first message', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/components/Workspace.tsx'), 'utf8')
    expect(source).toMatch(/startChat\.mutateAsync\(\{ featureId, kind: 'chat', holdOpening: true \}\)/)
  })
})

describe('the scenario errand in the column', () => {
  it('brings the scenario chat an errand opens to the front, naming it by its errand', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    expect(await within(column()).findByText('said in th_scn')).toBeTruthy()
    expect(switcher().textContent).toContain('Scenario chat · New scenario')
    // The drive keeps the panel: no chat is docked inside it.
    expect(within(document.querySelector('[data-panel]') as HTMLElement).queryByLabelText('Message')).toBeNull()
  })

  it('names a Fix it errand by its scenario', async () => {
    const api = server()
    render(<Page scenario={FAILED} />, { wrapper: api.Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    await waitFor(() => expect(switcher().textContent).toContain('Scenario chat · Fix Expired coupon'))
  })

  it('hands the column back when the errand is closed, and New scenario brings it to the front again', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    newScenario()
    await within(column()).findByText('said in th_scn')
    menuAction('Close the scenario chat')
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

describe('the feature header’s status', () => {
  /** The header's status line as the feature page derives it: the main chat's thread state, the row's stale turn bit beside it. */
  function Header() {
    const column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
    const status = featureStatus({
      feature: { status: 'active', waitingReason: null },
      rounds: [],
      declarations: [],
      agentWorking: mainChatWorking(column.mainState, { awaitingInput: false }),
      driving: false,
      selfPlanning: false,
      now: at,
    })
    return <FeatureStatusLine status={status} />
  }

  it('leaves Working when the main chat’s turn ends, on the thread signal alone', async () => {
    let state: ThreadEntry['state'] = 'working'
    const api = server({ extra: { 'thread.list': () => [thread('th_main', 'Feature chat', 'main', { state })] } })
    render(<Header />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Working'))

    // A lead wake's turn ends: the log says idle, and its `thread` live signal invalidates thread.list (lib/live.ts).
    state = 'idle'
    await act(() => api.queryClient.invalidateQueries({ queryKey: [['thread', 'list']] }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Talking with you'))
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
