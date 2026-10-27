// @vitest-environment happy-dom
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
      list.push(thread('th_side', 'Untitled', 'side'))
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
function Page({ driveSessionId, scenario, sessions = [] }: { driveSessionId?: string; scenario?: DriveScenario; sessions?: FeatureFull['sessions'] }) {
  const column = useFeatureChatColumn({ featureId: 'feat_1', sessions, driveSessionId })
  const full = { ...fixture({ id: 'feat_1' }), sessions, tickets: [] } as FeatureFull
  return (
    <ScenarioChatContext.Provider value={column.scenario}>
      <header>
        <ThreadSwitcher threads={column.threads} current={column.current} onPick={column.pick} onNew={column.newThread}>
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
        <ScenarioDrive projectId="proj_1" featureId="feat_1" drive={{ devUrl: 'about:blank', ...(scenario ? { scenario } : {}) }} />
      </div>
    </ScenarioChatContext.Provider>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
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

  it('makes a side thread with New thread and selects it', async () => {
    const api = server()
    render(<Page />, { wrapper: api.Wrapper })
    await within(column()).findByText('said in th_main')
    menuAction('New thread')
    expect(await within(column()).findByText('said in th_side')).toBeTruthy()
    expect(api.inputs('thread.new')).toEqual([{ featureId: 'feat_1' }])
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

  it('shows a feature chat nobody started as an empty thread, and its first Send starts it', async () => {
    const api = server({ threads: [] })
    render(<Page />, { wrapper: api.Wrapper })
    expect(switcher().textContent).toContain('Feature chat')
    expect(within(column()).getByText('New thread')).toBeTruthy()
    fireEvent.change(within(column()).getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(within(column()).getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(within(column()).getByText('Plan the export')).toBeTruthy()
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
