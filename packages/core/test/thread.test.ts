import { describe, expect, it } from 'vitest'
import { foldThread, liveEvents, ThreadEvent, type ThreadEventBody, type ThreadItem } from '../src/thread'

/** A log from bodies, one second apart unless an `at` is given. */
function log(...bodies: Array<ThreadEventBody | [number, ThreadEventBody]>): ThreadEvent[] {
  return bodies.map((b, i) => {
    const [at, body] = Array.isArray(b) ? b : [i * 1000, b]
    return { i, at, ...body } as ThreadEvent
  })
}

const kinds = (items: ThreadItem[]) => items.map((x) => x.kind)

const prompt = (id: string, text = 'hi', extra: Partial<Extract<ThreadEventBody, { type: 'prompt' }>> = {}): ThreadEventBody => ({
  type: 'prompt',
  id,
  text,
  source: 'human',
  ...extra,
})

describe('foldThread', () => {
  it('an empty log is an idle, empty thread', () => {
    const v = foldThread([])
    expect(v).toMatchObject({ items: [], state: 'idle', process: 'stopped', cursor: -1 })
  })

  it('a turn of only words is one answer, no work', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: 'Hel' },
        { type: 'agent_text', messageId: 'm1', text: 'lo' },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'agent'])
    expect(v.items[1]).toMatchObject({ kind: 'agent', text: 'Hello' })
    expect(v.state).toBe('idle')
    expect(v.cursor).toBe(5)
  })

  it('trailing words are the answer; words before a tool call become narration in the work', () => {
    const events = log(
      prompt('p1'),
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm1', text: 'Let me look.' },
      { type: 'tool', call: { id: 'c1', kind: 'read', title: 'a.ts', status: 'in_progress' } },
      { type: 'tool', call: { id: 'c1', status: 'completed' } },
      { type: 'agent_text', messageId: 'm2', text: 'Done.' },
    )
    const live = foldThread(events)
    expect(kinds(live.items)).toEqual(['user', 'work', 'agent'])
    const work = live.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.live).toBe(true)
    expect(work.steps.map((s) => s.kind)).toEqual(['narration', 'tools'])
    expect(live.state).toBe('working')

    const settled = foldThread([...events, { i: 6, at: 223_000, type: 'turn_ended', reason: 'end_turn' }])
    const w = settled.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(w.live).toBeUndefined()
    expect(w.seconds).toBe(222)
    expect(settled.items[2]).toMatchObject({ kind: 'agent', text: 'Done.' })
  })

  it('streaming words show as the answer until a tool call turns them into narration', () => {
    const before = foldThread(log(prompt('p1'), { type: 'turn_started' }, { type: 'agent_text', messageId: 'm1', text: 'Checking' }))
    expect(kinds(before.items)).toEqual(['user', 'agent'])
    const after = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: 'Checking' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'in_progress' } },
      ),
    )
    expect(kinds(after.items)).toEqual(['user', 'work'])
  })

  it('consecutive tool calls share a step; a subagent collects its own calls', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'read', title: 'a', status: 'completed' } },
        { type: 'tool', call: { id: 'c2', kind: 'read', title: 'b', status: 'completed' } },
        { type: 'subagent', id: 's1', title: 'Explore', status: 'in_progress' },
        { type: 'tool', call: { id: 'c3', kind: 'search', title: 'q', status: 'completed' }, parentId: 's1' },
        { type: 'subagent', id: 's1', status: 'completed' },
      ),
    )
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps).toMatchObject([
      { kind: 'tools', calls: [{ id: 'c1' }, { id: 'c2' }] },
      { kind: 'subagent', title: 'Explore', status: 'completed', calls: [{ id: 'c3' }] },
    ])
  })

  it('an update for a call never seen is absorbed as a call', () => {
    const v = foldThread(log(prompt('p1'), { type: 'turn_started' }, { type: 'tool', call: { id: 'c9', status: 'completed' } }))
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps[0]).toMatchObject({ kind: 'tools', calls: [{ id: 'c9', kind: 'other', status: 'completed' }] })
  })

  it('thinking reports its own duration', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        [2000, { type: 'thought', thoughtId: 't1', text: 'Hmm, ' }],
        [8000, { type: 'thought', thoughtId: 't1', text: 'yes.' }],
        [9000, { type: 'tool', call: { id: 'c1', kind: 'read', title: 'a', status: 'completed' } }],
      ),
    )
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps[0]).toMatchObject({ kind: 'thought', seconds: 6, text: 'Hmm, yes.' })
  })

  it('a prompt sent with no agent running shows starting until the process runs', () => {
    const waiting = foldThread(log(prompt('p1'), { type: 'process', state: 'starting' }))
    expect(waiting.items[0]).toMatchObject({ kind: 'user', starting: true })
    expect(waiting.process).toBe('starting')
    const running = foldThread(log(prompt('p1'), { type: 'process', state: 'starting' }, { type: 'process', state: 'running' }))
    expect(running.items[0]).not.toHaveProperty('starting')
  })

  it('a runcastle prompt is runcastle’s line, not the human’s', () => {
    const v = foldThread(log(prompt('p1', 'Round 1 finished', { source: 'runcastle' })))
    expect(v.items[0]).toMatchObject({ kind: 'user', from: 'runcastle' })
  })

  it('a steered message sits between the work before it and the work after it', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'read', title: 'a', status: 'completed' } },
        prompt('p2', 'also check b', { steered: true }),
        { type: 'tool', call: { id: 'c2', kind: 'read', title: 'b', status: 'in_progress' } },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'user', 'work'])
    expect(v.items[1]).not.toHaveProperty('live')
    expect(v.items[2]).toMatchObject({ steered: true })
    expect(v.items[3]).toMatchObject({ live: true })
    expect(v.state).toBe('working')
  })

  it('an open ask makes the thread wait; its answer folds to lines and work resumes after it', () => {
    const approval = { kind: 'approval' as const, id: 'a1', call: { id: 'c1', kind: 'execute' as const, title: 'bun add x', status: 'pending' as const } }
    const asking = log(prompt('p1'), { type: 'turn_started' }, { type: 'agent_text', messageId: 'm1', text: 'I need a package.' }, { type: 'ask', ask: approval })
    const waiting = foldThread(asking)
    expect(waiting.state).toBe('waiting')
    expect(waiting.ask).toEqual(approval)

    const answered = foldThread([
      ...asking,
      { i: 4, at: 4000, type: 'ask_resolved', id: 'a1', lines: [{ what: 'Allowed', answer: 'bun add x' }] },
      { i: 5, at: 5000, type: 'agent_text', messageId: 'm2', text: 'Installed.' },
    ])
    expect(answered.state).toBe('working')
    expect(answered.ask).toBeUndefined()
    expect(kinds(answered.items)).toEqual(['user', 'agent', 'answered', 'agent'])
  })

  it("an MCP server's form or link waits like any ask, and its answer folds to lines", () => {
    const form: ThreadEventBody = {
      type: 'ask',
      ask: {
        kind: 'form',
        id: 'f1',
        server: 'linear',
        message: 'Which team?',
        fields: [
          { key: 'team', type: 'enum', title: 'Team', required: true, options: [{ value: 'eng', label: 'Engineering' }] },
          { key: 'notify', type: 'boolean', title: 'Notify', default: false },
        ],
      },
    }
    const asking = log(prompt('p1'), { type: 'turn_started' }, form)
    const waiting = foldThread(asking)
    expect(waiting.state).toBe('waiting')
    expect(waiting.ask).toMatchObject({ kind: 'form', id: 'f1', server: 'linear' })
    expect(ThreadEvent.safeParse(asking[2]).success).toBe(true)

    const filled = foldThread([...asking, { i: 3, at: 3000, type: 'ask_resolved', id: 'f1', lines: [{ what: 'Team:', answer: 'Engineering' }] }])
    expect(filled.ask).toBeUndefined()
    expect(filled.items.at(-1)).toMatchObject({ kind: 'answered', what: 'Team:', answer: 'Engineering' })

    const link: ThreadEventBody = { type: 'ask', ask: { kind: 'link', id: 'l1', message: 'Sign in to Linear', url: 'https://linear.app/oauth' } }
    const opened = log(prompt('p1'), { type: 'turn_started' }, link)
    expect(foldThread(opened).ask).toEqual({ kind: 'link', id: 'l1', message: 'Sign in to Linear', url: 'https://linear.app/oauth' })
    const declined = foldThread([...opened, { i: 3, at: 3000, type: 'ask_resolved', id: 'l1', lines: [{ what: 'Declined', answer: 'Sign in to Linear', denied: true }] }])
    expect(declined.state).toBe('working')
    expect(declined.items.at(-1)).toMatchObject({ kind: 'answered', denied: true })
  })

  it('a stopped turn says so and fails the call in flight', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'in_progress' } },
        { type: 'turn_ended', reason: 'cancelled' },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'stopped'])
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps[0]).toMatchObject({ calls: [{ status: 'failed' }] })
  })

  it('a failed turn and a process that dies mid-turn both leave an error line', () => {
    const failed = foldThread(log(prompt('p1'), { type: 'turn_started' }, { type: 'turn_ended', reason: 'error', error: 'rate limited' }))
    expect(failed.items.at(-1)).toMatchObject({ kind: 'error', message: 'rate limited' })
    const died = foldThread(log(prompt('p1'), { type: 'turn_started' }, { type: 'process', state: 'stopped', error: 'adapter exited 1' }))
    expect(died.state).toBe('idle')
    expect(died.items.filter((x) => x.kind === 'error')).toHaveLength(1)
  })

  it('what a turn changed follows its answer', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: 'Done.' },
        { type: 'turn_ended', reason: 'end_turn', files: [{ path: 'a.ts', added: 2, removed: 1, lines: [] }] },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'agent', 'changes'])
  })

  it('a model divider appears only when the model changes after one was set', () => {
    const v = foldThread(
      log(
        { type: 'model', model: 'opus', label: 'Opus 5.5', effort: 'high' },
        prompt('p1'),
        { type: 'model', model: 'opus', label: 'Opus 5.5', effort: 'max' },
        { type: 'model', model: 'sonnet', label: 'Sonnet 5.5' },
        prompt('p2'),
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'model', 'user'])
    expect(v.model).toEqual({ id: 'sonnet', label: 'Sonnet 5.5' })
  })

  it('each answer names the model that wrote it', () => {
    const v = foldThread(
      log({ type: 'model', model: 'opus', label: 'Opus 5.5' }, prompt('p1'), { type: 'turn_started' }, { type: 'agent_text', messageId: 'm1', text: 'Hi' }),
    )
    expect(v.items[1]).toMatchObject({ kind: 'agent', model: 'Opus 5.5' })
  })

  it('the plan shows only while the thread is busy; a suggestion clears on the next prompt', () => {
    const busy = log(prompt('p1'), { type: 'turn_started' }, { type: 'plan', entries: [{ content: 'a', status: 'in_progress' }] })
    expect(foldThread(busy).plan).toHaveLength(1)
    expect(foldThread([...busy, { i: 3, at: 3000, type: 'turn_ended', reason: 'end_turn' }]).plan).toEqual([])

    const suggested = log({ type: 'suggestion', text: 'commit it' })
    expect(foldThread(suggested).suggestion).toBe('commit it')
    expect(foldThread([...suggested, { i: 1, at: 1000, ...prompt('p1') } as ThreadEvent]).suggestion).toBeUndefined()
  })

  it('rewinding to a prompt drops it and everything after it from the fold, not from the log', () => {
    const events = log(
      prompt('p1', 'first'),
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm1', text: 'one' },
      { type: 'turn_ended', reason: 'end_turn' },
      prompt('p2', 'second'),
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm2', text: 'two' },
      { type: 'turn_ended', reason: 'end_turn' },
      { type: 'rewound', toPromptId: 'p2' },
      prompt('p3', 'second, edited'),
    )
    expect(liveEvents(events)).toHaveLength(5)
    const v = foldThread(events)
    expect(v.items.map((x) => (x.kind === 'user' || x.kind === 'agent' ? x.text : x.kind))).toEqual(['first', 'one', 'second, edited'])
    expect(v.cursor).toBe(9)
  })

  it('compaction, titles and commands carry through', () => {
    const v = foldThread(
      log({ type: 'compacted' }, { type: 'title', title: 'PDF export' }, { type: 'commands', commands: [{ name: 'compact', description: 'x' }] }),
    )
    expect(kinds(v.items)).toEqual(['compacted'])
    expect(v.title).toBe('PDF export')
    expect(v.commands).toHaveLength(1)
  })

  it('every log line parses with the event schema', () => {
    const line = { i: 0, at: 1, type: 'prompt', id: 'p', text: 't', source: 'human' }
    expect(ThreadEvent.parse(line)).toEqual(line)
    expect(() => ThreadEvent.parse({ i: 0, at: 1, type: 'nope' })).toThrow()
  })
})
