// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent } from '@runcastle/core'
import { fakeTrpc } from './fake-trpc'
import { openMenu } from './floating'

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

  it('offers a Fast mode row only where the model the thread runs on has it, and sends fast with the next message', async () => {
    const plain = server(ON_SONNET, { 'thread.models': () => ({ runtime: 'claude-code', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }], current: 'claude-sonnet-5-5' }) })
    const { unmount } = render(<ThreadColumn threadId="th1" />, { wrapper: plain.Wrapper })
    await waitFor(() => expect(plain.inputs('thread.models')).toHaveLength(1))
    openMenu(await screen.findByRole('button', { name: 'Model' }))
    expect(screen.getByRole('menuitemradio', { name: /Sonnet 5.5/ })).toBeTruthy()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Fast mode' })).toBeNull()
    unmount()

    const api = server(ON_SONNET, {
      'thread.models': () => ({ runtime: 'claude-code', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', fast: true }], current: 'claude-sonnet-5-5' }),
      'thread.setModel': () => ({ ok: true }),
    })
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await waitFor(() => expect(api.inputs('thread.models')).toHaveLength(1))
    openMenu(await screen.findByRole('button', { name: 'Model' }))
    const row = await screen.findByRole('menuitemcheckbox', { name: 'Fast mode' })
    expect(row.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(row)
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
