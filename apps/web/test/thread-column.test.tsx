// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent } from '@runcastle/core'
import { fakeTrpc } from './fake-trpc'
import { openMenu, pickOption } from './floating'

/**
 * The chat column for one thread (chat-as-web-components decisions 7, 8): the
 * approved components over the thread API. The seam is ThreadColumn on the
 * app's real tRPC hooks; the server is the boundary, faked by path. A live
 * `{ kind: 'thread' }` signal is what `useLiveSync` turns into an invalidation
 * of the thread's `events`, so the test invalidates exactly that.
 */

const toasts = vi.hoisted(() => [] as string[])
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: (m: string) => toasts.push(m) }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ThreadColumn } = await import('../src/components/chat/ThreadColumn')
const { putInInbox } = await import('../src/lib/composer-inbox')

const at = 1_700_000_000_000
const prompt = (i: number, id: string, text: string): ThreadEvent => ({ i, at, type: 'prompt', id, text, source: 'human' })
const said = (i: number, text: string): ThreadEvent => ({ i, at, type: 'agent_text', messageId: `m${i}`, text })
const HISTORY: ThreadEvent[] = [
  prompt(0, 'p1', 'Make the export button line up'),
  { i: 1, at, type: 'turn_started' },
  said(2, 'Lined up — it had its own margin.'),
  { i: 3, at: at + 4000, type: 'turn_ended', reason: 'end_turn' },
]

/** A thread that ran on Opus, as its log names it in runcastle's roster id. */
const ON_OPUS: ThreadEvent[] = [{ i: 0, at, type: 'model', model: 'claude-opus-5', label: 'Opus 5' }, ...HISTORY.map((e) => ({ ...e, i: e.i + 1 }))]

/** A fake server holding one thread's log; `after` reads what follows the cursor. */
function server(log: ThreadEvent[], extra: Record<string, (input: never) => unknown> = {}) {
  return fakeTrpc({
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': ({ after }: { after?: number }) => ({ events: log.filter((e) => after === undefined || e.i > after) }),
    'thread.send': () => ({ promptId: 'p_sent' }),
    'thread.answer': () => ({ ok: true }),
    ...extra,
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  toasts.length = 0
})

describe('ThreadColumn', () => {
  it('renders the thread’s history from its log, folded', async () => {
    const api = server(HISTORY)
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    expect(await screen.findByText('Make the export button line up')).toBeTruthy()
    expect(await screen.findByText('Lined up — it had its own margin.')).toBeTruthy()
  })

  it('shows a thread with history loading, never as an empty new thread, until its first read answers', async () => {
    let release = () => undefined as void
    const answered = new Promise<void>((resolve) => (release = resolve))
    const api = fakeTrpc({
      'thread.view': async () => {
        await answered
        return { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }
      },
      'thread.events': async () => {
        await answered
        return { events: HISTORY }
      },
    })
    render(<ThreadColumn threadId="th1" emptyHint="One chat per feature" />, { wrapper: api.Wrapper })
    expect(await screen.findByText('Loading the thread…')).toBeTruthy()
    expect(screen.queryByText('New thread')).toBeNull()
    await act(async () => release())
    expect(await screen.findByText('Lined up — it had its own margin.')).toBeTruthy()
    expect(screen.queryByText('New thread')).toBeNull()
    expect(screen.queryByText('Loading the thread…')).toBeNull()
  })

  it('welcomes a thread that is really empty once its read says so', async () => {
    const api = server([])
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    expect(await screen.findByText('New thread')).toBeTruthy()
    expect(screen.queryByText('Loading the thread…')).toBeNull()
  })

  it('reads only what follows its cursor when a live thread signal arrives', async () => {
    const log = [...HISTORY]
    const api = server(log)
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Lined up — it had its own margin.')
    log.push(prompt(4, 'p2', 'And the print button?'))
    // What `useLiveSync` does on `{ kind: 'thread', threadId: 'th1' }`.
    await act(() => api.queryClient.invalidateQueries({ queryKey: [['thread', 'events'], { input: { threadId: 'th1' } }] }))
    expect(await screen.findByText('And the print button?')).toBeTruthy()
    expect(api.inputs('thread.events')).toEqual([{ threadId: 'th1' }, { threadId: 'th1', after: 3 }])
  })

  describe('a thread switched away from mid-turn and back', () => {
    const OTHER: ThreadEvent[] = [prompt(0, 'q1', 'Rename the export menu'), { i: 1, at, type: 'turn_started' }, said(2, 'Renamed.'), { i: 3, at, type: 'turn_ended', reason: 'end_turn' }]
    const MID_TURN: ThreadEvent[] = [prompt(0, 'p1', 'Line up the export button'), { i: 1, at, type: 'process', state: 'running' }, { i: 2, at, type: 'turn_started' }]
    const ANSWERED: ThreadEvent[] = [said(3, 'Lined up.'), { i: 4, at: at + 4000, type: 'turn_ended', reason: 'end_turn' }]

    function twoThreads() {
      const logs: Record<string, ThreadEvent[]> = { th1: [...MID_TURN], th2: [...OTHER] }
      const api = fakeTrpc({
        'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
        'thread.events': ({ threadId, after }: { threadId: string; after?: number }) => ({
          events: logs[threadId].filter((e) => after === undefined || e.i > after),
        }),
      })
      return { api, logs }
    }

    it('shows where the thread is now when reopened, with no live signal to say so', async () => {
      const { api, logs } = twoThreads()
      const view = render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
      await screen.findByText('Line up the export button')
      view.rerender(<ThreadColumn threadId="th2" />)
      await screen.findByText('Renamed.')
      logs.th1.push(...ANSWERED)
      view.rerender(<ThreadColumn threadId="th1" />)
      expect(await screen.findByText('Lined up.')).toBeTruthy()
      expect(api.inputs('thread.events')).toContainEqual({ threadId: 'th1', after: 2 })
    })

    it('takes a live signal of a thread that is not open, and shows it on return', async () => {
      const { api, logs } = twoThreads()
      const view = render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
      await screen.findByText('Line up the export button')
      view.rerender(<ThreadColumn threadId="th2" />)
      await screen.findByText('Renamed.')
      logs.th1.push(...ANSWERED)
      // What `useLiveSync` does on `{ kind: 'thread', threadId: 'th1' }` while th2 is open.
      await act(() => api.queryClient.invalidateQueries({ queryKey: [['thread', 'events'], { input: { threadId: 'th1' } }] }))
      view.rerender(<ThreadColumn threadId="th1" />)
      expect(await screen.findByText('Lined up.')).toBeTruthy()
      expect(screen.queryByText('Working')).toBeNull()
    })

    it('a column mounted afresh on a thread read before picks up past its cursor', async () => {
      const { api, logs } = twoThreads()
      const first = render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
      await screen.findByText('Line up the export button')
      first.unmount()
      logs.th1.push(...ANSWERED)
      render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
      expect(await screen.findByText('Lined up.')).toBeTruthy()
    })
  })

  it('shows a sent message at once, and lets the server’s prompt take its place', async () => {
    const log = [...HISTORY]
    let release = () => {}
    const api = server(log, {
      'thread.send': () => new Promise((resolve) => (release = () => resolve({ promptId: 'p2' }))),
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Lined up — it had its own margin.')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Now the print button' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    expect(await screen.findByText('Now the print button')).toBeTruthy()
    expect(screen.getByText('Starting the agent…')).toBeTruthy()
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th1', text: 'Now the print button' }]))
    log.push(prompt(4, 'p2', 'Now the print button'))
    await act(async () => {
      release()
      await api.queryClient.invalidateQueries({ queryKey: [['thread', 'events']] })
    })
    await waitFor(() => expect(screen.getAllByText('Now the print button')).toHaveLength(1))
  })

  it('starts a never-started chat through its launch on the first Send, then sends to the thread it answers with', async () => {
    const api = server([])
    const order: string[] = []
    const start = vi.fn(async () => {
      order.push('start')
      return 'th_new'
    })
    const onStarted = vi.fn()
    render(<ThreadColumn threadId={null} start={start} onStarted={onStarted} draftKey="feature:f1:main" />, { wrapper: api.Wrapper })
    expect(screen.getByText('New thread')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Let’s plan the export' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    expect(await screen.findByText('Let’s plan the export')).toBeTruthy()
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_new', text: 'Let’s plan the export' }]))
    expect(start).toHaveBeenCalledOnce()
    expect(onStarted).toHaveBeenCalledWith('th_new')
  })

  it('shows the model controls on a never-started chat, on the model it would start on, and the first send carries the choice', async () => {
    const api = server([], {
      'thread.models': () => ({
        runtime: 'claude-code',
        models: [
          { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'max'] },
          { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'] },
        ],
        current: 'claude-opus-5-5',
      }),
    })
    const start = vi.fn(async () => 'th_new')
    render(<ThreadColumn threadId={null} start={start} startsAs={{ featureId: 'f1' }} draftKey="feature:f1:main" />, { wrapper: api.Wrapper })
    const model = await screen.findByRole('button', { name: 'Model' })
    expect(model.textContent).toBe('Opus 5.5')
    expect(api.inputs('thread.models')).toEqual([{ featureId: 'f1' }])
    // No session has said what Opus starts on: the runtime's own level, unnamed.
    expect(screen.getByRole('combobox', { name: 'Effort' }).textContent).toContain('Default')

    fireEvent.click(model)
    fireEvent.click(screen.getByRole('option', { name: /Sonnet 5.5/ }))
    pickOption(screen.getByRole('combobox', { name: 'Effort' }), 'Low')
    // Nothing is set on a thread that does not exist yet.
    expect(api.inputs('thread.setModel')).toEqual([])
    expect(start).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Plan the export' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() =>
      expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_new', text: 'Plan the export', model: 'claude-sonnet-5-5', effort: 'low' }]),
    )
  })

  it('sends a message on untouched model controls with no model, effort or fast mode: the server resolves them', async () => {
    const api = server([], {
      'thread.models': () => ({
        runtime: 'claude-code',
        models: [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', fast: true }],
        current: 'claude-opus-5',
      }),
    })
    render(<ThreadColumn threadId={null} start={async () => 'th_new'} startsAs={{ projectId: 'p1', kind: 'project' }} />, { wrapper: api.Wrapper })
    // The level a session on Opus starts on, not a guess.
    expect((await screen.findByRole('combobox', { name: 'Effort' })).textContent).toContain('High')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_new', text: 'Hello' }]))
  })

  it('shows a stopped thread on the model and effort it will start on, not the ones its last run logged', async () => {
    const api = server(
      [
        { i: 0, at, type: 'process', state: 'running' },
        { i: 1, at, type: 'model', model: 'claude-opus-5', label: 'Opus 5', effort: 'max' },
        { i: 2, at, type: 'process', state: 'stopped' },
      ],
      {
        'thread.models': () => ({
          runtime: 'claude-code',
          models: [
            { id: 'claude-opus-5', label: 'Opus 5', efforts: ['low', 'medium', 'high', 'max'] },
            { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'] },
          ],
          current: 'claude-sonnet-5-5',
          effort: 'low',
        }),
      },
    )
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Model' }).textContent).toBe('Sonnet 5.5'))
    expect(screen.getByRole('combobox', { name: 'Effort' }).textContent).toContain('Low')
  })

  it('names the model a switch moved to by its label once the list’s ids are the adapter’s own', async () => {
    let switched = false
    const api = server(ON_OPUS, {
      'thread.models': () =>
        switched
          ? { runtime: 'claude-code', models: [{ id: 'opus', label: 'Opus 5' }, { id: 'haiku', label: 'Haiku 4.5' }], current: 'haiku' }
          : { runtime: 'claude-code', models: [{ id: 'claude-opus-5', label: 'Opus 5' }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }], current: 'claude-opus-5' },
      'thread.setModel': () => {
        switched = true
        return { ok: true }
      },
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getByRole('option', { name: /Haiku 4.5/ }))
    await waitFor(() => expect(api.inputs('thread.setModel')).toEqual([{ threadId: 'th1', model: 'claude-haiku-4-5' }]))
    await waitFor(() => expect(api.inputs('thread.models')).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Model' }).textContent).toBe('Haiku 4.5'))
  })

  it('docks an approval in the composer’s place, and answering it calls thread.answer', async () => {
    const api = server([
      ...HISTORY,
      prompt(4, 'p2', 'Add the PDF library'),
      { i: 5, at, type: 'turn_started' },
      { i: 6, at, type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun add pdfkit', status: 'pending' } },
      { i: 7, at, type: 'ask', ask: { kind: 'approval', id: 'ask1', call: { id: 'c1', kind: 'execute', title: 'bun add pdfkit', status: 'pending' } } },
    ])
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Run this command?')
    expect(screen.queryByLabelText('Message')).toBeNull()
    fireEvent.keyDown(screen.getByRole('group', { name: 'The agent asks to' }), { key: '1' })
    await waitFor(() =>
      expect(api.inputs('thread.answer')).toEqual([{ threadId: 'th1', askId: 'ask1', answer: { kind: 'approval', choice: 'allow' } }]),
    )
  })

  it('shows a subagent’s row and a background command on the strip, with no Stop since no runtime lets runcastle stop one', async () => {
    const api = server([
      ...HISTORY,
      prompt(4, 'p2', 'Find the auth code and start the dev server'),
      { i: 5, at, type: 'turn_started' },
      { i: 6, at, type: 'subagent', id: 'child-1', title: 'Find the auth code', status: 'in_progress' },
      { i: 7, at, type: 'tool', call: { id: 'g1', kind: 'search', title: 'grep auth', status: 'completed' }, parentId: 'child-1' },
      { i: 8, at, type: 'tasks', tasks: [{ id: 'b1', title: 'bun run dev', startedAt: at }] },
    ])
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    expect(await screen.findByText('Find the auth code')).toBeTruthy()
    expect(await screen.findByText('bun run dev')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop this command' })).toBeNull()
  })

  const asking = (ask: Extract<ThreadEvent, { type: 'ask' }>['ask']): ThreadEvent[] => [
    ...HISTORY,
    prompt(4, 'p2', 'File the bug in Linear'),
    { i: 5, at, type: 'turn_started' },
    { i: 6, at, type: 'ask', ask },
  ]
  const FORM = {
    kind: 'form' as const,
    id: 'ask2',
    server: 'linear',
    message: 'Where should the issue go?',
    fields: [
      { key: 'team', type: 'enum' as const, title: 'Team', options: [{ value: 'eng', label: 'Engineering' }, { value: 'ops', label: 'Operations' }] },
      { key: 'email', type: 'string' as const, title: 'Reporter', format: 'email' as const, required: true },
      { key: 'points', type: 'number' as const, title: 'Points', integer: true, default: 3 },
      { key: 'urgent', type: 'boolean' as const, title: 'Urgent' },
    ],
  }

  it('docks an MCP server’s form with its fields, holds a missing required field, and submits its values', async () => {
    const api = server(asking(FORM))
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Where should the issue go?')
    expect(screen.getByText('linear asks')).toBeTruthy()
    expect(screen.queryByLabelText('Message')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Required')
    expect(api.inputs('thread.answer')).toEqual([])

    fireEvent.click(screen.getByRole('radio', { name: /Operations/ }))
    fireEvent.change(screen.getByLabelText(/Reporter/), { target: { value: 'sam@example.com' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(api.inputs('thread.answer')).toEqual([
        { threadId: 'th1', askId: 'ask2', answer: { kind: 'form', values: { team: 'ops', email: 'sam@example.com', points: 3, urgent: true } } },
      ]),
    )
  })

  it('declines an MCP server’s form on Decline, and on Esc', async () => {
    const api = server(asking(FORM))
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Where should the issue go?')
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.keyDown(screen.getByRole('form', { name: 'An MCP server asks' }), { key: 'Escape' })
    await waitFor(() => expect(api.inputs('thread.answer')).toHaveLength(2))
    expect(api.inputs('thread.answer')).toEqual([
      { threadId: 'th1', askId: 'ask2', answer: { kind: 'decline' } },
      { threadId: 'th1', askId: 'ask2', answer: { kind: 'decline' } },
    ])
  })

  it('docks an MCP server’s link to open, with Done and Decline', async () => {
    const api = server(asking({ kind: 'link', id: 'ask3', message: 'Sign in to Linear', url: 'https://linear.app/oauth?x=1' }))
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Sign in to Linear')
    expect(screen.getByText('An MCP server asks')).toBeTruthy()
    const link = screen.getByRole('link', { name: /linear\.app\/oauth/ })
    expect(link.getAttribute('href')).toBe('https://linear.app/oauth?x=1')
    expect(link.getAttribute('target')).toBe('_blank')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.keyDown(screen.getByRole('group', { name: 'An MCP server asks' }), { key: 'Escape' })
    await waitFor(() =>
      expect(api.inputs('thread.answer')).toEqual([
        { threadId: 'th1', askId: 'ask3', answer: { kind: 'link', done: true } },
        { threadId: 'th1', askId: 'ask3', answer: { kind: 'decline' } },
      ]),
    )
  })

  it('keeps each thread’s draft, and ↑ brings back the last message', async () => {
    const api = server(HISTORY)
    const { unmount } = render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Lined up — it had its own margin.')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'half a thought' } })
    unmount()
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('half a thought')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'ArrowUp' })
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Make the export button line up')
  })

  it('degrades quietly while the controls’ reads are refused: the picker names the thread’s model, the meter shows context alone', async () => {
    const api = server([
      { i: 0, at, type: 'model', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      { i: 1, at, type: 'usage', context: { used: 40_000, size: 200_000 } },
      ...HISTORY.map((e) => ({ ...e, i: e.i + 2 })),
    ])
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    const picker = await screen.findByRole('button', { name: 'Model' })
    expect(picker.textContent).toContain('Sonnet 5.5')
    expect(screen.getByRole('button', { name: 'Context 20% used' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'look at @src' } })
    await waitFor(() => expect(api.inputs('thread.files')).toHaveLength(1))
    expect(screen.queryByRole('listbox', { name: 'Files' })).toBeNull()
    expect(toasts).toEqual([])
  })

  const ON_SONNET: ThreadEvent[] = [
    { i: 0, at, type: 'model', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { i: 1, at, type: 'usage', context: { used: 40_000, size: 200_000 } },
    ...HISTORY.map((e) => ({ ...e, i: e.i + 2 })),
  ]

  it('offers fast mode only where the model the thread runs on has it, and sends fast with the next message', async () => {
    const plain = server(ON_SONNET, { 'thread.models': () => ({ runtime: 'claude-code', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }], current: 'claude-sonnet-5-5' }) })
    const { unmount } = render(<ThreadColumn threadId="th1" />, { wrapper: plain.Wrapper })
    await waitFor(() => expect(plain.inputs('thread.models')).toHaveLength(1))
    expect((await screen.findByRole('button', { name: 'Model' })).textContent).toBe('Sonnet 5.5')
    expect(screen.queryByRole('button', { name: 'Fast mode' })).toBeNull()
    unmount()

    const api = server(ON_SONNET, {
      'thread.models': () => ({ runtime: 'claude-code', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', fast: true }], current: 'claude-sonnet-5-5' }),
      'thread.setModel': () => ({ ok: true }),
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    const toggle = await screen.findByRole('button', { name: 'Fast mode' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(api.inputs('thread.setModel')).toEqual([{ threadId: 'th1', model: 'claude-sonnet-5-5', fast: true }]))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Quickly now' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th1', text: 'Quickly now', fast: true }]))
  })

  it('compacts through thread.compact from the context meter, with no message of the human’s', async () => {
    const api = server(ON_SONNET, { 'thread.compact': () => ({ ok: true }) })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Context 20% used' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Compact now' }))
    await waitFor(() => expect(api.inputs('thread.compact')).toEqual([{ threadId: 'th1' }]))
    expect(api.inputs('thread.send')).toEqual([])
    expect(screen.queryByText('/compact')).toBeNull()
  })

  it('reads the usage limits again as the meter opens, so a meter that first read nothing fills', async () => {
    let reads = 0
    const api = server(ON_SONNET, {
      'thread.usage': () => (++reads === 1 ? { limits: [] } : { limits: [{ label: 'Current 30-day window', percent: 13, resets: '' }], plan: 'ChatGPT Free' }),
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await waitFor(() => expect(api.inputs('thread.usage')).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Context 20% used' }))
    expect(await screen.findByText('Current 30-day window')).toBeTruthy()
    expect(screen.getByText('ChatGPT Free')).toBeTruthy()
    expect(api.inputs('thread.usage')).toHaveLength(2)
  })

  it('says why Compact is refused while the agent works', async () => {
    const api = server(ON_SONNET, {
      'thread.compact': () => {
        throw new Error('the agent is working: compact once its turn ends')
      },
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Context 20% used' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Compact now' }))
    await waitFor(() => expect(toasts).toEqual(['the agent is working: compact once its turn ends']))
  })

  it('sends edit and branch for the message they are on, and says nothing while they are refused', async () => {
    const api = server(HISTORY)
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Lined up — it had its own margin.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Branch into a new thread from here' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Edit and rewind to here' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rewind and send' }))
    await waitFor(() => expect(api.inputs('thread.edit')).toEqual([{ threadId: 'th1', promptId: 'p1', text: 'Make the export button line up', undoFiles: true }]))
    // Branching from the answer branches from the message it answered.
    expect(api.inputs('thread.branch')).toEqual([{ threadId: 'th1', promptId: 'p1' }])
    expect(toasts).toEqual([])
  })

  it('takes a crop waiting in its inbox as an image chip and focuses the composer', async () => {
    const api = server(HISTORY)
    URL.createObjectURL = vi.fn(() => 'blob:crop')
    render(<ThreadColumn threadId="th1" inbox="feature:f1:main" />, { wrapper: api.Wrapper })
    await screen.findByText('Lined up — it had its own margin.')
    await act(async () => {
      putInInbox('feature:f1:main', [new File(['png'], 'selection.png', { type: 'image/png' })])
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    expect(screen.getByRole('img', { name: 'selection.png' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Message'))
  })
})
