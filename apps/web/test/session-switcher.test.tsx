// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull, FeatureSessionEntry } from '../src/lib/api'
import { openMenu } from './floating'

/**
 * The feature chat header's session switcher (several-sessions-per-feature
 * decisions 8, 10, 12), driven through the Chat tab it switches: the menu's
 * groups, the amber waiting dot, New side session, and what picking a live
 * versus an ended row puts in the tab. The server is stubbed at the tRPC edge.
 */

const api = vi.hoisted(() => ({
  list: [] as FeatureSessionEntry[],
  open: vi.fn(),
  end: vi.fn(),
  openPending: false,
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    project: {
      conversationTranscript: {
        useQuery: ({ sessionId }: { sessionId: string }) => ({
          isPending: false,
          data: { status: 'ok', runtime: 'claude-code', turns: [{ role: 'user', text: `said in ${sessionId}` }] },
        }),
      },
    },
    events: { list: { useQuery: () => ({ data: [] }) } },
    feature: {
      sessions: { useQuery: () => ({ data: api.list }) },
      openSideSession: {
        useMutation: (opts: { onSuccess?: (r: { sessionId: string }) => void }) => ({
          isPending: api.openPending,
          mutate: (input: unknown) => {
            const sessionId = api.open(input) as string
            opts.onSuccess?.({ sessionId })
          },
        }),
      },
      endSession: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            api.end(input)
            opts.onSuccess?.()
          },
        }),
      },
    },
    useUtils: () => ({
      feature: {
        get: { invalidate: () => undefined },
        list: { invalidate: () => undefined },
        sessions: { invalidate: () => undefined },
      },
    }),
  },
}))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] }))
vi.mock('../src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => createElement('div', { 'data-terminal': sessionId }),
}))

import { ToastProvider } from '../src/lib/toast'
import { FeatureChat } from '../src/components/workspace/FeatureChat'
import { full as fixture } from './fixtures'

type Row = FeatureFull['sessions'][number]

function row(over: Partial<Row>): Row {
  return {
    id: 'sess_main',
    featureId: 'feat_1',
    kind: 'chat',
    status: 'live',
    awaitingInput: false,
    worktreePath: '/tmp/talk',
    lap: 1,
    createdAt: 0,
    ...over,
  } as Row
}

function entry(over: Partial<FeatureSessionEntry>): FeatureSessionEntry {
  return {
    id: 'sess_main',
    kind: 'chat',
    title: 'Main chat',
    status: 'live',
    awaitingInput: false,
    createdAt: 0,
    endedAt: null,
    ...over,
  }
}

const MAIN = entry({})
const WAITING = entry({ id: 'sess_wait', kind: 'side', title: 'Why does the burn skip ticket 4?', awaitingInput: true })
const LIVE = entry({ id: 'sess_live', kind: 'side', title: 'Write the drive scenario' })
const ENDED = entry({
  id: 'sess_old',
  kind: 'side',
  title: 'Rename the status column',
  status: 'ended',
  endedAt: Date.now() - 60_000,
})

const ROWS = [
  row({}),
  row({ id: 'sess_wait', kind: 'side', awaitingInput: true }),
  row({ id: 'sess_live', kind: 'side' }),
  row({ id: 'sess_old', kind: 'side', status: 'ended' }),
]

function renderChat(rows: Row[] = ROWS) {
  const f = fixture()
  return render(
    <ToastProvider>
      <FeatureChat
        full={{ ...f, sessions: rows }}
        events={[]}
        hidden={false}
        launching={false}
        onLaunch={() => undefined}
        onView={() => undefined}
      />
    </ToastProvider>,
  )
}

const switcher = () => screen.getByRole('button', { name: /switch session/ })

function pick(name: string | RegExp) {
  openMenu(switcher())
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

beforeEach(() => {
  api.list = [MAIN, WAITING, LIVE, ENDED]
  api.open.mockReset()
  api.end.mockReset()
  api.openPending = false
})
afterEach(cleanup)

describe('the session switcher', () => {
  it('shows the main chat by default, even with side sessions live', () => {
    const { container } = renderChat()
    expect(switcher().textContent).toContain('Main chat')
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_main')
  })

  it('groups its menu Main, then Side sessions, then Ended', () => {
    renderChat()
    openMenu(switcher())
    const menu = screen.getByRole('menu')
    const text = menu.textContent ?? ''
    const order = ['Main', 'Main chat', 'Side sessions', WAITING.title, LIVE.title, 'Ended', ENDED.title]
    const at = order.map((word) => text.indexOf(word))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(within(menu).getByRole('menuitem', { name: new RegExp(ENDED.title) }).textContent).toContain('1m ago')
  })

  it('marks a waiting side session with an amber dot on its row and on the switcher', () => {
    renderChat()
    expect(within(switcher()).getByRole('img', { name: 'A side session is waiting' })).toBeTruthy()
    openMenu(switcher())
    const waitingRow = screen.getByRole('menuitem', { name: new RegExp(WAITING.title) })
    expect(waitingRow.textContent).toContain('waiting')
    expect(waitingRow.querySelector('.bg-warning')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: new RegExp(LIVE.title) }).querySelector('.bg-warning')).toBeNull()
  })

  it('drops the switcher’s dot while the waiting session is the one in view', () => {
    api.list = [MAIN, WAITING]
    renderChat()
    pick(new RegExp(WAITING.title))
    expect(within(switcher()).queryByRole('img', { name: 'A side session is waiting' })).toBeNull()
  })

  it('shows a live side session’s terminal when picked, with End session', () => {
    const { container } = renderChat()
    pick(new RegExp(LIVE.title))
    expect(switcher().textContent).toContain(LIVE.title)
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_live')
    fireEvent.click(screen.getByRole('button', { name: /End session/ }))
    expect(api.end).toHaveBeenCalledWith({ sessionId: 'sess_live' })
  })

  it('shows an ended side session’s transcript with Reopen, which resumes it and stays on it', () => {
    api.open.mockReturnValue('sess_reopened')
    const { container } = renderChat()
    pick(new RegExp(ENDED.title))
    expect(container.querySelector('[data-terminal]')).toBeNull()
    expect(screen.getByText('said in sess_old')).toBeTruthy()

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Reopen' })))

    expect(api.open).toHaveBeenCalledWith({ featureId: 'feat_1', reopenSessionId: 'sess_old' })
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_reopened')
  })

  it('moves an ended side session to its transcript once End lands', () => {
    const { container, rerender } = renderChat()
    pick(new RegExp(LIVE.title))
    api.list = [MAIN, WAITING, { ...LIVE, status: 'ended', endedAt: Date.now() }, ENDED]
    const f = fixture()
    rerender(
      <ToastProvider>
        <FeatureChat
          full={{ ...f, sessions: ROWS.map((r) => (r.id === 'sess_live' ? { ...r, status: 'ended' } : r)) }}
          events={[]}
          hidden={false}
          launching={false}
          onLaunch={() => undefined}
          onView={() => undefined}
        />
      </ToastProvider>,
    )
    expect(container.querySelector('[data-terminal]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
    openMenu(switcher())
    const endedLabel = screen.getByText('Ended')
    const row = screen.getByRole('menuitem', { name: new RegExp(LIVE.title) })
    expect(endedLabel.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens a new side session from the header and selects it', () => {
    api.open.mockReturnValue('sess_new')
    const { container } = renderChat()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'New side session' })))
    expect(api.open).toHaveBeenCalledWith({ featureId: 'feat_1' })
    expect(switcher().textContent).toContain('Untitled')
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_new')
  })

  it('shows a live scenario chat’s terminal when picked', () => {
    api.list = [MAIN, entry({ id: 'sess_scn', kind: 'scenario', title: 'Scenario chat' })]
    const { container } = renderChat([row({}), row({ id: 'sess_scn', kind: 'scenario' })])
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_main')
    pick(/Scenario chat/)
    expect(container.querySelector('[data-terminal]')?.getAttribute('data-terminal')).toBe('sess_scn')
  })
})
