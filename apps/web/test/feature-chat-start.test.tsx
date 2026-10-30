// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { fakeTrpc, type FakeHandlers } from './fake-trpc'
import { full as fixture } from './fixtures'

/**
 * A new feature's chat starts itself the first time the human can see it, and
 * no other chat does (decisions 6, 10, 11, 14). The seam is FeatureChat on its
 * real column; `start` stands for the launch and the server is faked by path.
 */

const toasts = vi.hoisted(() => [] as string[])
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (m: string) => toasts.push(m) }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { FeatureChat } = await import('../src/components/workspace/FeatureChat')

type Start = (opts: { holdOpening: boolean }) => Promise<string>

function server(extra: FakeHandlers = {}) {
  return fakeTrpc({
    'thread.list': () => [],
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': () => ({ events: [] }),
    'thread.send': () => ({ promptId: 'p_sent' }),
    ...extra,
  })
}

const NEW_FEATURE = { sessions: [], tickets: [], runs: [], docs: [{ relPath: 'brief.md', title: 'Brief' }] } as unknown as Partial<FeatureFull>

function Chat({ over = NEW_FEATURE, hidden = false, launching = false, start }: { over?: Partial<FeatureFull>; hidden?: boolean; launching?: boolean; start: Start }) {
  const full = { ...fixture({ id: 'feat_1' }), ...NEW_FEATURE, ...over } as FeatureFull
  const column = useFeatureChatColumn({ featureId: 'feat_1', sessions: full.sessions, driveSessionId: undefined })
  return <FeatureChat full={full} column={column} events={[]} hidden={hidden} launching={launching} start={start} onView={() => {}} />
}

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 10)))

function setTabVisible(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  setTabVisible(true)
  toasts.length = 0
})

describe('a new feature’s chat', () => {
  it('starts itself once when opened, saying its opening now', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const { rerender } = render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledWith({ holdOpening: false }))
    rerender(<Chat start={start} />)
    await settle()
    expect(start).toHaveBeenCalledOnce()
  })

  it('waits for the thread list: a slow read never starts a second chat', async () => {
    let answer: (threads: unknown[]) => void = () => undefined
    const api = server({ 'thread.list': () => new Promise((resolve) => (answer = resolve)) })
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await settle()
    expect(start).not.toHaveBeenCalled()
    await act(async () => answer([{ id: 'th_main', title: 'Chat', role: 'main', state: 'idle', createdAt: 1, updatedAt: 1, runtime: 'claude-code' }]))
    await settle()
    expect(start).not.toHaveBeenCalled()
  })

  it('waits while the panel covers the chat', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const { rerender } = render(<Chat start={start} hidden />, { wrapper: api.Wrapper })
    await settle()
    expect(start).not.toHaveBeenCalled()
    rerender(<Chat start={start} />)
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
  })

  it('waits for a hidden tab to show', async () => {
    setTabVisible(false)
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await settle()
    expect(start).not.toHaveBeenCalled()
    act(() => setTabVisible(true))
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
  })

  it.each([
    ['a shipped feature', { feature: { ...fixture({ id: 'feat_1' }).feature, status: 'shipped' } }],
    ['an archived feature', { feature: { ...fixture({ id: 'feat_1' }).feature, status: 'archived' } }],
    ['a feature with tickets', { tickets: [{ id: 't1' }] }],
    ['a feature with a round', { runs: [{ id: 'r1' }] }],
    ['a feature with an older session', { sessions: [{ id: 's1', kind: 'side' }] }],
    ['a feature whose brief is not written yet', { docs: [] }],
  ])('leaves %s waiting for a first message', async (_, over) => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} over={over as unknown as Partial<FeatureFull>} />, { wrapper: api.Wrapper })
    await settle()
    expect(start).not.toHaveBeenCalled()
  })

  it('stays out of the way of the page’s own launch', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const { rerender } = render(<Chat start={start} launching />, { wrapper: api.Wrapper })
    await settle()
    expect(start).not.toHaveBeenCalled()
    rerender(<Chat start={start} />)
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
  })

  it('leaves the human on a thread they picked while it started', async () => {
    let started: (id: string) => void = () => undefined
    const api = server({ 'thread.new': () => ({ threadId: 'th_side' }) })
    const start = vi.fn<Start>(() => new Promise((resolve) => (started = resolve)))
    let column: ReturnType<typeof useFeatureChatColumn> | undefined
    function Picking() {
      const full = { ...fixture({ id: 'feat_1' }), ...NEW_FEATURE } as FeatureFull
      column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
      return <FeatureChat full={full} column={column} events={[]} hidden={false} launching={false} start={start} onView={() => {}} />
    }
    render(<Picking />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    await act(async () => column?.pick('th_side'))
    await act(async () => started('th_started'))
    await settle()
    expect(column?.inFront).toBe('th_side')
  })

  it('a refused start says so once and leaves the empty chat, and the next open tries again', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => {
      throw new Error('Claude Code is not ready')
    })
    const first = render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(toasts).toEqual(['Claude Code is not ready']))
    expect(screen.getByText('New thread')).toBeTruthy()
    first.rerender(<Chat start={start} />)
    await settle()
    expect(start).toHaveBeenCalledOnce()
    first.unmount()
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
  })

  it('after a refused start the first Send tries, holding the opening for that message', async () => {
    const api = server()
    const start = vi.fn<Start>(async ({ holdOpening }) => {
      if (!holdOpening) throw new Error('not ready')
      return 'th_started'
    })
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(toasts).toEqual(['not ready']))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(start).toHaveBeenLastCalledWith({ holdOpening: true })
  })

  it('a Send waiting on a refused start says the refusal once', async () => {
    let refuse: (e: Error) => void = () => undefined
    const api = server()
    const start = vi.fn<Start>(() => new Promise((_, reject) => (refuse = reject)))
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'One more thing' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await settle()
    await act(async () => refuse(new Error('not ready')))
    await waitFor(() => expect(toasts).toEqual(['not ready']))
    await settle()
    expect(toasts).toEqual(['not ready'])
  })

  it('a Send during its start waits on that start and joins the chat', async () => {
    let started: (id: string) => void = () => undefined
    const api = server()
    const start = vi.fn<Start>(() => new Promise((resolve) => (started = resolve)))
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'One more thing' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await settle()
    await act(async () => started('th_started'))
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'One more thing' }]))
    expect(start).toHaveBeenCalledOnce()
  })

  it('a draft left behind reaches the main chat the next time it opens, even if the column was gone as it started', async () => {
    localStorage.setItem('runcastle.thread.draft:feature:feat_1:main', 'left behind')
    const api = server({ 'thread.list': () => [{ id: 'th_main', title: 'Chat', role: 'main', state: 'idle', createdAt: 1, updatedAt: 1, runtime: 'claude-code' }] })
    const start = vi.fn<Start>(async () => 'th_main')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(localStorage.getItem('runcastle.thread.draft:th_main')).toBe('left behind'))
    expect(localStorage.getItem('runcastle.thread.draft:feature:feat_1:main')).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it('a draft left in the unstarted chat moves to the thread it gets', async () => {
    localStorage.setItem('runcastle.thread.draft:feature:feat_1:main', 'half a thought')
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    await waitFor(() => expect(localStorage.getItem('runcastle.thread.draft:th_started')).toBe('half a thought'))
    expect(localStorage.getItem('runcastle.thread.draft:feature:feat_1:main')).toBeNull()
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('half a thought')
  })
})
