import { describe, expect, it } from 'vitest'
import { awaitsHuman, foldThread, lastPickedModel, liveEvents, ThreadEvent, type ThreadEventBody, type ThreadItem } from '../src/thread'

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

  it("a held opening and the human's first message are runcastle's line, the human's bubble, then one answer", () => {
    const opening = prompt('p1', 'Opening', { source: 'runcastle' })
    const waiting = foldThread(log(opening, prompt('p2', 'Hello'), { type: 'process', state: 'starting' }))
    expect(waiting.items).toMatchObject([{ id: 'p1', from: 'runcastle' }, { id: 'p2', starting: true }])
    expect(waiting.items[0]).not.toHaveProperty('starting')
    const answered = foldThread(
      log(
        opening,
        prompt('p2', 'Hello'),
        { type: 'process', state: 'starting' },
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: 'Hi.' },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(kinds(answered.items)).toEqual(['user', 'user', 'agent'])
    expect(answered.items.some((x) => x.kind === 'user' && x.starting)).toBe(false)
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
    expect(kinds(answered.items)).toEqual(['user', 'work', 'answered', 'agent'])
  })

  it('a turn with approvals folds as one turn: each approved command is one row that settles, and no row is blank', () => {
    // claude-agent-acp's permission flow: the tool_call surfaces first, the
    // permission request names the same toolCallId, and once allowed the tool's
    // updates carry its status and output but no title.
    const approved = (n: number, command: string): ThreadEventBody[] => [
      { type: 'tool', call: { id: `toolu_${n}`, kind: 'execute', title: command, status: 'pending' } },
      { type: 'ask', ask: { kind: 'approval', id: `ask_${n}`, call: { id: `toolu_${n}`, kind: 'execute', title: command, status: 'pending' } } },
      { type: 'ask_resolved', id: `ask_${n}`, lines: [{ what: 'Allowed', answer: command }] },
      { type: 'tool', call: { id: `toolu_${n}`, status: 'in_progress' } },
      { type: 'tool', call: { id: `toolu_${n}`, status: 'completed', output: 'ok' } },
    ]
    const events = log(
      prompt('p1', 'Set up the repo'),
      { type: 'process', state: 'running' },
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm1', text: 'Installing first.' },
      ...approved(1, 'bun install'),
      ...approved(2, 'bun run build'),
      // The third is allowed and still running when its turn is read.
      ...approved(3, 'git init').slice(0, 4),
      { type: 'agent_text', messageId: 'm2', text: 'All set.' },
    )
    const live = foldThread(events)
    expect(kinds(live.items)).toEqual(['user', 'work', 'answered', 'answered', 'answered', 'agent'])
    const running = live.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(running.live).toBe(true)

    const settled = foldThread([...events, { i: events.length, at: 99_000, type: 'turn_ended', reason: 'end_turn' }])
    expect(kinds(settled.items)).toEqual(['user', 'work', 'answered', 'answered', 'answered', 'agent'])
    const work = settled.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.live).toBeUndefined()
    expect(work.steps.map((s) => s.kind)).toEqual(['narration', 'tools', 'tools', 'tools'])
    const calls = work.steps.flatMap((s) => (s.kind === 'tools' ? s.calls : []))
    expect(calls.map((c) => [c.title, c.status])).toEqual([
      ['bun install', 'completed'],
      ['bun run build', 'completed'],
      ['git init', 'completed'],
    ])
    expect(settled.items[5]).toMatchObject({ kind: 'agent', text: 'All set.' })
  })

  it("an approval whose call never surfaced is the call's row, and its later updates keep the approval's title", () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'ask', ask: { kind: 'approval', id: 'a1', call: { id: 'call_1', kind: 'edit', title: 'Edit a.ts', status: 'pending' } } },
        { type: 'ask_resolved', id: 'a1', lines: [{ what: 'Allowed', answer: 'Edit a.ts' }] },
        { type: 'tool', call: { id: 'call_1', title: '', status: 'completed' } },
      ),
    )
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps).toMatchObject([{ kind: 'tools', calls: [{ id: 'call_1', kind: 'edit', title: 'Edit a.ts', status: 'completed' }] }])
  })

  it('a denied command fails its row', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'rm -rf dist', status: 'pending' } },
        { type: 'ask', ask: { kind: 'approval', id: 'a1', call: { id: 'c1', kind: 'execute', title: 'rm -rf dist', status: 'pending' } } },
        { type: 'ask_resolved', id: 'a1', lines: [{ what: 'Denied', answer: 'rm -rf dist', denied: true }] },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    const work = v.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps).toMatchObject([{ kind: 'tools', calls: [{ id: 'c1', status: 'failed' }] }])
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

  it('a turn a server restart cut off says the restart interrupted it, not that you stopped it', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'in_progress' } },
        { type: 'process', state: 'stopped', restarted: true },
      ),
    )
    expect(v.state).toBe('idle')
    expect(kinds(v.items)).toEqual(['user', 'work', 'notice'])
    expect(v.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Interrupted — runcastle restarted' })
    expect((v.items[1] as Extract<ThreadItem, { kind: 'work' }>).steps[0]).toMatchObject({ calls: [{ status: 'failed' }] })
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

  it('a model divider names the effort when it changed with the model', () => {
    const v = foldThread(
      log(
        { type: 'model', model: 'opus', label: 'Opus 5.5', effort: 'high' },
        prompt('p1'),
        { type: 'model', model: 'sonnet', label: 'Sonnet 5.5', effort: 'low' },
        prompt('p2'),
        { type: 'model', model: 'opus', label: 'Opus 5.5', effort: 'low' },
      ),
    )
    expect(v.items.filter((i) => i.kind === 'model')).toEqual([
      { kind: 'model', id: 'model:2', model: 'Sonnet 5.5', effort: 'low' },
      { kind: 'model', id: 'model:4', model: 'Opus 5.5' },
    ])
  })

  it('picks made with nothing said between them draw one divider, and none when they come back to the model before', () => {
    const tried = foldThread(
      log(
        { type: 'model', model: 'opus', label: 'Opus 5.5' },
        prompt('p1'),
        { type: 'model', model: 'sonnet', label: 'Sonnet 5.5' },
        { type: 'model', model: 'haiku', label: 'Haiku 5.5' },
        { type: 'model', model: 'fable', label: 'Fable 5.1' },
        prompt('p2'),
      ),
    )
    expect(tried.items.filter((i) => i.kind === 'model').map((i) => i.kind === 'model' && i.model)).toEqual(['Fable 5.1'])
    expect(kinds(tried.items)).toEqual(['user', 'model', 'user'])

    const back = foldThread(
      log(
        { type: 'model', model: 'opus', label: 'Opus 5.5' },
        prompt('p1'),
        { type: 'model', model: 'sonnet', label: 'Sonnet 5.5' },
        { type: 'model', model: 'opus', label: 'Opus 5.5' },
      ),
    )
    expect(back.items.filter((i) => i.kind === 'model')).toEqual([])
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

  it('a hidden command prompt shows no message; its turn still runs and ends in the compaction divider', () => {
    const working = foldThread(log(prompt('p0', 'Hello'), prompt('c1', '/compact', { source: 'runcastle', hidden: true }), { type: 'turn_started' }))
    expect(working.items.map((x) => (x.kind === 'user' ? x.text : x.kind))).toEqual(['Hello'])
    expect(working.state).toBe('working')
    const done = foldThread(
      log(prompt('c1', '/compact', { source: 'runcastle', hidden: true }), { type: 'turn_started' }, { type: 'compacted' }, { type: 'turn_ended', reason: 'end_turn' }),
    )
    expect(kinds(done.items)).toEqual(['compacted'])
    expect(done.state).toBe('idle')
  })

  it('one compaction reported twice draws one divider, and the cost outlives a report without it', () => {
    const v = foldThread(
      log(
        prompt('c1', '/compact', { source: 'runcastle', hidden: true }),
        { type: 'turn_started' },
        { type: 'usage', context: { used: 90000, size: 200000, costUsd: 1.25 } },
        { type: 'compacted' },
        { type: 'compacted' },
        { type: 'usage', context: { used: 8000, size: 200000 } },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(kinds(v.items)).toEqual(['compacted'])
    expect(v.context).toEqual({ used: 8000, size: 200000, costUsd: 1.25 })
    const again = foldThread(log(prompt('c1', '/compact', { hidden: true }), { type: 'compacted' }, prompt('c2', '/compact', { hidden: true }), { type: 'compacted' }))
    expect(kinds(again.items)).toEqual(['compacted', 'compacted'])
  })

  it('the cost adds up across agent restarts: a new process counting from zero adds to what the last one spent', () => {
    const v = foldThread(
      log(
        prompt('p1', 'one'),
        { type: 'process', state: 'running' },
        { type: 'usage', context: { used: 1000, size: 200000, costUsd: 0.2 } },
        { type: 'usage', context: { used: 2000, size: 200000, costUsd: 0.36 } },
        { type: 'process', state: 'stopped' },
        prompt('p2', 'two'),
        { type: 'process', state: 'starting' },
        { type: 'process', state: 'running' },
        { type: 'usage', context: { used: 3000, size: 200000, costUsd: 0.02 } },
        { type: 'usage', context: { used: 3500, size: 200000, costUsd: 0.05 } },
      ),
    )
    expect(v.context?.costUsd).toBeCloseTo(0.41)
    // Without a restart, a report is the running process's total, never added twice.
    const steady = foldThread(
      log(
        { type: 'process', state: 'running' },
        { type: 'usage', context: { used: 1000, size: 200000, costUsd: 0.2 } },
        { type: 'usage', context: { used: 2000, size: 200000, costUsd: 0.3 } },
      ),
    )
    expect(steady.context?.costUsd).toBeCloseTo(0.3)
  })

  it('words logged after a turn ended, with no turn around them, settle: the thread is not working', () => {
    const v = foldThread(
      log(
        prompt('p1', 'Run the tests in the background'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: 'Started them.' },
        { type: 'turn_ended', reason: 'end_turn' },
        { type: 'tasks', tasks: [] },
        { type: 'agent_text', messageId: 'm2', text: 'The tests passed.' },
        { type: 'usage', context: { used: 1000, size: 200000 } },
      ),
    )
    expect(v.state).toBe('idle')
    expect(v.turnStartedAt).toBeUndefined()
    expect(v.items.at(-1)).toMatchObject({ kind: 'agent', text: 'The tests passed.' })
  })

  it('a turn the agent started by itself works until it ends', () => {
    const events = log(
      prompt('p1'),
      { type: 'process', state: 'running' },
      { type: 'turn_started' },
      { type: 'turn_ended', reason: 'end_turn' },
      { type: 'turn_started', source: 'agent' },
      { type: 'agent_text', messageId: 'm2', text: 'The build finished.' },
    )
    expect(foldThread(events).state).toBe('working')
    const settled = foldThread([...events, { i: 6, at: 6000, type: 'turn_ended', reason: 'end_turn' }])
    expect(settled.state).toBe('idle')
    expect(settled.items.at(-1)).toMatchObject({ kind: 'agent', text: 'The build finished.' })
  })

  it('a notice is a quiet line of its own', () => {
    const v = foldThread(log(prompt('p1'), { type: 'notice', text: 'Started a new conversation' }))
    expect(v.items.at(-1)).toEqual({ kind: 'notice', id: 'notice:1', text: 'Started a new conversation' })
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

describe('lastPickedModel', () => {
  const opus = { type: 'model', model: 'opus', label: 'Opus 5' } as const
  const sonnet = { type: 'model', model: 'sonnet', label: 'Sonnet 5', picked: true } as const
  const running = { type: 'process', state: 'running' } as const

  it('is the model the human last chose, before a start or while it runs', () => {
    expect(lastPickedModel(log(prompt('p1'), sonnet, running, opus))).toMatchObject({ model: 'sonnet' })
    expect(lastPickedModel(log(prompt('p1'), running, opus, { type: 'turn_started' }, sonnet))).toMatchObject({ model: 'sonnet' })
  })

  it('is never a model logged as its process came up, though round 13 marked some picked there', () => {
    expect(lastPickedModel(log(prompt('p1'), { type: 'process', state: 'starting' }, running, sonnet))).toBeNull()
    expect(lastPickedModel(log(prompt('p1'), running, opus))).toBeNull()
  })
})

describe('awaitsHuman', () => {
  const started: ThreadEventBody = { type: 'turn_started' }
  const ended: ThreadEventBody = { type: 'turn_ended', reason: 'end_turn' }
  const said: ThreadEventBody = { type: 'agent_text', messageId: 'm1', text: 'Done.' }
  const stopped: ThreadEventBody = { type: 'process', state: 'stopped' }
  const ask: ThreadEventBody = {
    type: 'ask',
    ask: { kind: 'approval', id: 'a1', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'pending' } },
  }

  it('waits on the human once the agent replied after their message', () => {
    expect(awaitsHuman(log(prompt('p1'), started, said, ended), true)).toBe(true)
  })

  it('waits on the human after a wake runcastle sent ends its turn', () => {
    expect(awaitsHuman(log(prompt('w1', 'Round 2 returned', { source: 'runcastle' }), started, said, ended), true)).toBe(true)
  })

  it('stops waiting the moment the human answers', () => {
    expect(awaitsHuman(log(prompt('p1'), started, said, ended, prompt('p2')), false)).toBe(false)
  })

  it('does not wait while the agent is mid-turn', () => {
    expect(awaitsHuman(log(prompt('p1'), started, said), true)).toBe(false)
    expect(awaitsHuman(log(prompt('p1'), started, said, ended, { type: 'turn_started', source: 'agent' }), true)).toBe(false)
  })

  it('still waits after the idle stop took the process that replied', () => {
    expect(awaitsHuman(log(prompt('p1'), started, said, ended, stopped), false)).toBe(true)
  })

  it('waits on an open ask only while the process that asked runs', () => {
    expect(awaitsHuman(log(prompt('p1'), started, ask), true)).toBe(true)
    expect(awaitsHuman(log(prompt('p1'), started, ask), false)).toBe(false)
    expect(awaitsHuman(log(prompt('p1'), started, ask, { type: 'ask_resolved', id: 'a1', lines: [] }), true)).toBe(false)
  })

  it('a turn the human stopped, a cut-off one, or a hidden command’s is no reply', () => {
    expect(awaitsHuman(log(prompt('p1'), started, said, { type: 'turn_ended', reason: 'cancelled' }), true)).toBe(false)
    expect(awaitsHuman(log(prompt('p1'), started, said, stopped), false)).toBe(false)
    expect(awaitsHuman(log(prompt('p1', '/compact', { hidden: true }), started, ended), true)).toBe(false)
  })

  it('an empty thread waits on nobody', () => {
    expect(awaitsHuman([], false)).toBe(false)
  })
})
