// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import type { ModelPick } from '../src/lib/use-thread'
import { fakeTrpc, type FakeHandlers } from './fake-trpc'
import { full as fixture } from './fixtures'
import { pickOption } from './floating'

/**
 * A never-run feature's chat waits for Start (a-new-feature-waits-for-start
 * decisions 1, 2, 3, 5, 8, 10): opening it launches nothing; Start and Plan it
 * yourself each launch once, on the locked composer's model pick; a refusal
 * says why under them. A feature with history keeps its typed-first start.
 * The seam is FeatureChat on its real column; `start` and `onPlanItYourself`
 * stand for the page's launches and the server is faked by path.
 */

const toasts = vi.hoisted(() => [] as string[])
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (m: string) => toasts.push(m) }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { FeatureChat } = await import('../src/components/workspace/FeatureChat')

type Start = (opts: { holdOpening: boolean; pick?: ModelPick }) => Promise<string>
type PlanAlone = (pick: ModelPick) => Promise<unknown>

const MODELS = {
  runtime: 'claude-code',
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'max'], fast: true },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], fast: true },
  ],
  current: 'claude-opus-5-5',
}

function server(extra: FakeHandlers = {}) {
  return fakeTrpc({
    'thread.list': () => [],
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': () => ({ events: [] }),
    'thread.send': () => ({ promptId: 'p_sent' }),
    'thread.models': () => MODELS,
    ...extra,
  })
}

const NEW_FEATURE = { sessions: [], tickets: [], runs: [], docs: [{ relPath: 'brief.md', title: 'Brief' }] } as unknown as Partial<FeatureFull>
const WITH_HISTORY = { tickets: [{ id: 't1' }] } as unknown as Partial<FeatureFull>

function Chat({
  over = NEW_FEATURE,
  holdStart = false,
  start,
  planAlone = async () => undefined,
  refusal,
}: {
  over?: Partial<FeatureFull>
  holdStart?: boolean
  start: Start
  planAlone?: PlanAlone
  refusal?: string
}) {
  const full = { ...fixture({ id: 'feat_1' }), ...NEW_FEATURE, ...over } as FeatureFull
  const column = useFeatureChatColumn({ featureId: 'feat_1', sessions: full.sessions, driveSessionId: undefined })
  return (
    <FeatureChat
      full={full}
      column={column}
      events={[]}
      hidden={false}
      holdStart={holdStart}
      start={start}
      onPlanItYourself={planAlone}
      refusal={refusal}
      onView={() => {}}
    />
  )
}

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 10)))
const startButton = () => screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement
const planButton = () => screen.getByRole('button', { name: 'Plan it yourself' }) as HTMLButtonElement
const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement

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

describe('a never-run feature’s chat', () => {
  it('waits on Start and Plan it yourself, its composer locked, and launches nothing by itself', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const planAlone = vi.fn<PlanAlone>(async () => undefined)
    const { rerender } = render(<Chat start={start} planAlone={planAlone} />, { wrapper: api.Wrapper })
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
    expect(planButton()).toBeTruthy()
    expect(box().disabled).toBe(true)
    expect(box().placeholder).toBe('Start the agent first — it opens the chat')

    rerender(<Chat start={start} planAlone={planAlone} />)
    act(() => setTabVisible(false))
    act(() => setTabVisible(true))
    await act(async () => api.queryClient.invalidateQueries())
    await settle()
    expect(start).not.toHaveBeenCalled()
    expect(planAlone).not.toHaveBeenCalled()
    expect(startButton()).toBeTruthy()
  })

  it('waits for the thread list: shows nothing to press until it is read, and a listed main chat is the chat', async () => {
    let answer: (threads: unknown[]) => void = () => undefined
    const api = server({ 'thread.list': () => new Promise((resolve) => (answer = resolve)) })
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await settle()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    await act(async () => answer([{ id: 'th_main', title: 'Chat', role: 'main', state: 'idle', createdAt: 1, updatedAt: 1, runtime: 'claude-code' }]))
    await settle()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it('Start launches once, saying its opening now, on the model, effort and fast mode picked', async () => {
    let started: (id: string) => void = () => undefined
    const api = server()
    const start = vi.fn<Start>(() => new Promise((resolve) => (started = resolve)))
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    const model = await screen.findByRole('button', { name: 'Model' })
    fireEvent.click(model)
    fireEvent.click(screen.getByRole('option', { name: /Sonnet 5.5/ }))
    pickOption(screen.getByRole('combobox', { name: 'Effort' }), 'Low')
    fireEvent.click(screen.getByRole('button', { name: 'Fast mode' }))

    fireEvent.click(startButton())
    fireEvent.click(startButton())
    await settle()
    expect(start).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith({ holdOpening: false, pick: { model: 'claude-sonnet-5-5', effort: 'low', fast: true } })
    // In flight: both off.
    expect(startButton().disabled).toBe(true)
    expect(planButton().disabled).toBe(true)

    await act(async () => started('th_started'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start' })).toBeNull())
    expect(box().disabled).toBe(false)
    expect(start).toHaveBeenCalledOnce()
  })

  it('Start on untouched controls carries no pick: Settings decide', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await screen.findByRole('button', { name: 'Model' })
    fireEvent.click(startButton())
    await waitFor(() => expect(start).toHaveBeenCalledWith({ holdOpening: false, pick: {} }))
  })

  it('a refused Start says why under the buttons, leaves Start pressable, and does not try again by itself', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => {
      throw new Error('Claude Code is not signed in')
    })
    const { rerender } = render(<Chat start={start} />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Claude Code is not signed in')
    expect(startButton().disabled).toBe(false)
    expect(toasts).toEqual([])
    rerender(<Chat start={start} />)
    act(() => setTabVisible(false))
    act(() => setTabVisible(true))
    await settle()
    expect(start).toHaveBeenCalledOnce()

    fireEvent.click(startButton())
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
  })

  it('Plan it yourself launches once on the pick and shows busy; its refusal shows the same way', async () => {
    let refuse: (e: Error) => void = () => undefined
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const planAlone = vi.fn<PlanAlone>(() => new Promise((_, reject) => (refuse = reject)))
    const { rerender } = render(<Chat start={start} planAlone={planAlone} />, { wrapper: api.Wrapper })
    const model = await screen.findByRole('button', { name: 'Model' })
    fireEvent.click(model)
    fireEvent.click(screen.getByRole('option', { name: /Sonnet 5.5/ }))
    fireEvent.click(planButton())
    fireEvent.click(planButton())
    fireEvent.click(startButton())
    // The page holds the chat while its self-planning launch is pending: the screen stays, busy.
    rerender(<Chat start={start} planAlone={planAlone} holdStart />)
    await settle()
    expect(planAlone).toHaveBeenCalledOnce()
    expect(planAlone).toHaveBeenCalledWith({ model: 'claude-sonnet-5-5' })
    expect(start).not.toHaveBeenCalled()
    expect(startButton().disabled).toBe(true)
    expect(planButton().disabled).toBe(true)

    rerender(<Chat start={start} planAlone={planAlone} />)
    await act(async () => refuse(new Error('the agent runtime is not ready')))
    expect((await screen.findByRole('alert')).textContent).toBe('the agent runtime is not ready')
    expect(startButton().disabled).toBe(false)
  })

  it('a backlog Start’s refused launch opens on Start with its refusal; a press clears it', async () => {
    const api = server()
    const start = vi.fn<Start>(() => new Promise(() => undefined))
    render(<Chat start={start} refusal="Claude Code is not signed in" />, { wrapper: api.Wrapper })
    expect((await screen.findByRole('alert')).textContent).toBe('Claude Code is not signed in')
    expect(start).not.toHaveBeenCalled()
    fireEvent.click(startButton())
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(start).toHaveBeenCalledOnce()
  })

  it('shows no Start while the page is launching the chat itself', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    const { rerender } = render(<Chat start={start} holdStart />, { wrapper: api.Wrapper })
    await settle()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    rerender(<Chat start={start} />)
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
    expect(start).not.toHaveBeenCalled()
  })

  it('leaves the human on a thread they picked while Start ran', async () => {
    let started: (id: string) => void = () => undefined
    const api = server({ 'thread.new': () => ({ threadId: 'th_side' }) })
    const start = vi.fn<Start>(() => new Promise((resolve) => (started = resolve)))
    let column: ReturnType<typeof useFeatureChatColumn> | undefined
    function Picking() {
      const full = { ...fixture({ id: 'feat_1' }), ...NEW_FEATURE } as FeatureFull
      column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
      return (
        <FeatureChat
          full={full}
          column={column}
          events={[]}
          hidden={false}
          holdStart={false}
          start={start}
          onPlanItYourself={async () => undefined}
          onView={() => {}}
        />
      )
    }
    render(<Picking />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    await act(async () => column?.pick('th_side'))
    await act(async () => started('th_started'))
    await settle()
    expect(column?.inFront).toBe('th_side')
  })

  it('a draft left in the unstarted chat moves to the thread Start gives it', async () => {
    localStorage.setItem('runcastle.thread.draft:feature:feat_1:main', 'half a thought')
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await waitFor(() => expect(localStorage.getItem('runcastle.thread.draft:th_started')).toBe('half a thought'))
    expect(localStorage.getItem('runcastle.thread.draft:feature:feat_1:main')).toBeNull()
    expect(box().value).toBe('half a thought')
  })
})

describe('a feature with history and no main chat', () => {
  it.each([
    ['a shipped feature', { feature: { ...fixture({ id: 'feat_1' }).feature, status: 'shipped' } }],
    ['an archived feature', { feature: { ...fixture({ id: 'feat_1' }).feature, status: 'archived' } }],
    ['a feature with tickets', { tickets: [{ id: 't1' }] }],
    ['a feature with a round', { runs: [{ id: 'r1' }] }],
    ['a feature with an older session', { sessions: [{ id: 's1', kind: 'side' }] }],
    ['a feature whose brief is not written yet', { docs: [] }],
  ])('keeps %s on the plain empty chat, launching nothing', async (_, over) => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} over={over as unknown as Partial<FeatureFull>} />, { wrapper: api.Wrapper })
    expect(await screen.findByText('New chat')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(box().disabled).toBe(false)
    await settle()
    expect(start).not.toHaveBeenCalled()
  })

  it('its first Send starts the chat, holding the opening for that message', async () => {
    const api = server()
    const start = vi.fn<Start>(async () => 'th_started')
    render(<Chat start={start} over={WITH_HISTORY} />, { wrapper: api.Wrapper })
    await screen.findByText('New chat')
    fireEvent.change(box(), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_started', text: 'Plan the export' }]))
    expect(start).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith({ holdOpening: true })
  })

  it('a draft left behind reaches the main chat the next time it opens', async () => {
    localStorage.setItem('runcastle.thread.draft:feature:feat_1:main', 'left behind')
    const api = server({ 'thread.list': () => [{ id: 'th_main', title: 'Chat', role: 'main', state: 'idle', createdAt: 1, updatedAt: 1, runtime: 'claude-code' }] })
    const start = vi.fn<Start>(async () => 'th_main')
    render(<Chat start={start} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(localStorage.getItem('runcastle.thread.draft:th_main')).toBe('left behind'))
    expect(localStorage.getItem('runcastle.thread.draft:feature:feat_1:main')).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })
})
