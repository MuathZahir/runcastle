import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_WINDOW_MS,
  featuresAskedAbout,
  foldThread,
  lastPickedModel,
  liveEvents,
  runningSubagents,
  threadActivity,
  ThreadEvent,
  type ShownFile,
  type ThreadEventBody,
  type ThreadItem,
} from '../src/thread'

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

const work = (v: ReturnType<typeof foldThread>, n = 0) => v.items.filter((x): x is Extract<ThreadItem, { kind: 'work' }> => x.kind === 'work')[n]

describe('foldThread: features card and prompt display', () => {
  const acted = (featureId: string, action: 'created' | 'parked' | 'planning' | 'messaged', extra: { quote?: string } = {}): ThreadEventBody => ({
    type: 'feature_acted',
    featureId,
    title: `Title ${featureId}`,
    action,
    ...extra,
  })
  const running: ThreadEventBody[] = [prompt('p1'), { type: 'process', state: 'running' }, { type: 'turn_started' }]
  const tool = (id: string): ThreadEventBody => ({ type: 'tool', call: { id, kind: 'other', title: 'create_feature', status: 'completed' } })
  const end: ThreadEventBody = { type: 'turn_ended', reason: 'end_turn' }
  const say = (text: string): ThreadEventBody => ({ type: 'agent_text', messageId: 'm', text })

  it('folds a turn\'s actions into one card after the work and before the final words, a second action joining its row', () => {
    const v = foldThread(
      log(...running, tool('c1'), acted('a', 'created'), tool('c2'), acted('b', 'created'), acted('c', 'parked'), acted('d', 'parked'), acted('a', 'planning'), acted('b', 'messaged', { quote: 'Go' }), say('Done.'), end),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'features_card', 'agent'])
    const card = v.items[2]
    expect(card.kind === 'features_card' && card.rows.map((r) => [r.featureId, r.actions])).toEqual([
      ['a', ['created', 'planning']],
      ['b', ['created', 'messaged']],
      ['c', ['parked']],
      ['d', ['parked']],
    ])
    expect(card.kind === 'features_card' && card.rows[1].quote).toBe('Go')
  })

  it('starts a new card after a prompt or in a new turn', () => {
    const v = foldThread(log(...running, acted('a', 'created'), prompt('p2', 'steer', { steered: true }), acted('b', 'created'), end, prompt('p3'), { type: 'turn_started' }, acted('c', 'created'), end))
    expect(v.items.filter((x) => x.kind === 'features_card')).toHaveLength(3)
  })

  it('copies a prompt\'s display onto its user item', () => {
    const display = { summary: 'Started this chat' }
    const v = foldThread(log(prompt('p1', 'Proceed', { source: 'runcastle', display })))
    expect(v.items[0]).toMatchObject({ kind: 'user', from: 'runcastle', display })
    expect(foldThread(log(prompt('p2'))).items[0]).not.toHaveProperty('display')
  })
})

describe('foldThread: workers card', () => {
  const started = (workerId: string): ThreadEventBody => ({
    type: 'worker_started',
    workerId,
    label: `Worker ${workerId}`,
    purpose: `Does ${workerId}`,
    kind: workerId === 'review' ? 'review' : 'on-its-own',
  })
  const running: ThreadEventBody[] = [prompt('p1'), { type: 'process', state: 'running' }, { type: 'turn_started' }]
  const tool = (id: string, status: 'in_progress' | 'completed' = 'completed'): ThreadEventBody => ({
    type: 'tool',
    call: { id, kind: 'other', title: 'mcp__runcastle__start_worker', status },
  })
  const end: ThreadEventBody = { type: 'turn_ended', reason: 'end_turn' }
  const say = (messageId: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId, text })
  const cards = (v: ReturnType<typeof foldThread>) =>
    v.items.filter((x): x is Extract<ThreadItem, { kind: 'workers_card' }> => x.kind === 'workers_card')

  it('gathers a turn\'s starts into one card, rows in start order, even with words between them', () => {
    const v = foldThread(
      log(...running, tool('c1'), started('a'), say('m1', 'Started a.'), tool('c2'), started('b'), say('m2', 'And b.'), tool('c3'), started('review'), end),
    )
    expect(cards(v)).toHaveLength(1)
    expect(cards(v)[0]!.rows.map((r) => r.workerId)).toEqual(['a', 'b', 'review'])
    expect(cards(v)[0]!.rows[2]).toEqual({ workerId: 'review', label: 'Worker review', purpose: 'Does review', kind: 'review' })
    // It closes the turn, after the lead's last words.
    expect(kinds(v.items)).toEqual(['user', 'work', 'agent', 'work', 'agent', 'work', 'workers_card'])
  })

  it('stands on its own: never inside a run of work, live or settled', () => {
    const live = foldThread(log(...running, tool('c1'), started('a'), tool('c2', 'in_progress')))
    expect(kinds(live.items)).toEqual(['user', 'work', 'workers_card'])
    const w = work(live)
    expect(w?.live).toBe(true)
    expect(w?.steps.every((s) => s.kind === 'tools')).toBe(true)
    const settled = foldThread(log(...running, tool('c1'), started('a'), tool('c2'), say('m1', 'Done.'), end))
    expect(kinds(settled.items)).toEqual(['user', 'work', 'agent', 'workers_card'])
  })

  it('makes one card per turn, and a worker started twice is one row', () => {
    const v = foldThread(
      log(...running, started('a'), started('a'), started('b'), end, prompt('p2'), { type: 'turn_started' }, started('c'), say('m', 'Started c.'), end),
    )
    expect(cards(v).map((c) => c.rows.map((r) => r.workerId))).toEqual([['a', 'b'], ['c']])
    expect(kinds(v.items)).toEqual(['user', 'workers_card', 'user', 'agent', 'workers_card'])
  })

  it('starts a new card after a steered prompt', () => {
    const v = foldThread(log(...running, started('a'), prompt('p2', 'steer', { steered: true }), started('b'), end))
    expect(cards(v).map((c) => c.rows.map((r) => r.workerId))).toEqual([['a'], ['b']])
  })
})

describe('foldThread: shown files', () => {
  const file = (id: string): ShownFile => ({ id, src: `/f/${id}.png`, name: `${id}.png`, path: `${id}.png`, size: 1, as: 'image' })
  const shown = (id: string): ThreadEventBody => ({ type: 'file_shown', file: file(id) })
  const tool = (id: string): ThreadEventBody => ({ type: 'tool', call: { id, kind: 'other', title: 'show_file', status: 'completed' } })
  const say = (messageId: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId, text })
  const running: ThreadEventBody[] = [prompt('p1'), { type: 'process', state: 'running' }, { type: 'turn_started' }]
  const names = (item: ThreadItem | undefined) => (item?.kind === 'shown' ? item.files.map((f) => f.id) : null)

  it('places a review package as it places a file, between the work and the final words', () => {
    const v = foldThread(log(...running, tool('c1'), { type: 'review_package', ticketId: 't1' }, say('m2', 'Merge it?'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(kinds(v.items)).toEqual(['user', 'work', 'review_package', 'agent'])
  })

  it('places a plan card and a group of design cards where they were shown, in order with the work and the words', () => {
    const design = (designId: string): ThreadEventBody => ({ type: 'design_shown', designId })
    const v = foldThread(log(...running, tool('c1'), { type: 'plan_shown' }, tool('c2'), design('d1'), design('d2'), say('m2', 'Have a look.'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(kinds(v.items)).toEqual(['user', 'work', 'plan_card', 'work', 'design_cards', 'agent'])
    expect(v.items[4]).toMatchObject({ kind: 'design_cards', designIds: ['d1', 'd2'], older: [] })
    expect(v.items[2]).toEqual({ kind: 'plan_card', id: expect.any(String) })
  })

  it('keeps the feature on a group of design cards, and groups one feature’s designs only', () => {
    const design = (designId: string, featureId: string): ThreadEventBody => ({ type: 'design_shown', designId, featureId })
    const v = foldThread(log(...running, design('d1', 'fa'), design('d2', 'fa'), design('d3', 'fb'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(v.items.filter((x) => x.kind === 'design_cards')).toEqual([
      { kind: 'design_cards', id: expect.any(String), designIds: ['d1', 'd2'], older: [], featureId: 'fa' },
      { kind: 'design_cards', id: expect.any(String), designIds: ['d3'], older: [], featureId: 'fb' },
    ])
  })

  it('starts a new group of design cards in the next turn, and marks the earlier cards of a design and the plan shown again as older', () => {
    const design = (designId: string): ThreadEventBody => ({ type: 'design_shown', designId })
    const end: ThreadEventBody = { type: 'turn_ended', reason: 'end_turn' }
    const v = foldThread(
      log(
        ...running, { type: 'plan_shown' }, design('d1'), design('d2'), end,
        prompt('p2'), { type: 'turn_started' }, { type: 'plan_shown' }, design('d2'), end,
      ),
    )
    const cards = v.items.filter((x) => x.kind === 'design_cards' || x.kind === 'plan_card')
    expect(cards).toEqual([
      { kind: 'plan_card', id: expect.any(String), older: true },
      { kind: 'design_cards', id: expect.any(String), designIds: ['d1', 'd2'], older: ['d2'] },
      { kind: 'plan_card', id: expect.any(String) },
      { kind: 'design_cards', id: expect.any(String), designIds: ['d2'], older: [] },
    ])
  })

  it('shows a file where it was shown: the words and work before it above, the words after it below', () => {
    const v = foldThread(log(...running, say('m1', 'Taking a look.'), tool('c1'), shown('a'), say('m2', 'Merge it?'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'work', 'shown', 'agent'])
    expect(work(v).steps.map((s) => s.kind)).toEqual(['tools'])
    expect(v.items[1]).toMatchObject({ text: 'Taking a look.' })
    expect(v.items[4]).toMatchObject({ text: 'Merge it?' })
  })

  it('shows at once in a running turn, and work after it stays above it in one group', () => {
    const v = foldThread(log(...running, tool('c1'), shown('a'), tool('c2'), shown('b')))
    expect(v.state).toBe('working')
    expect(kinds(v.items)).toEqual(['user', 'work', 'shown'])
    expect(names(v.items[2])).toEqual(['a', 'b'])
    expect(work(v).steps).toMatchObject([{ kind: 'tools', calls: [{ id: 'c1' }] }, { kind: 'tools', calls: [{ id: 'c2' }] }])
  })

  it('keeps words said before the file in view, above it', () => {
    const v = foldThread(log(...running, say('m1', 'Here it is.'), shown('a'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'shown'])
  })

  it('shows nothing for the show_file call itself, logged before or after its file', () => {
    const showFile = (id: string): ThreadEventBody => ({ type: 'tool', call: { id, kind: 'other', title: 'mcp__runcastle__show_file', status: 'completed' } })
    const v = foldThread(log(...running, shown('a'), showFile('c1'), say('m1', 'Done.'), showFile('c2'), shown('b'), { type: 'turn_ended', reason: 'end_turn' }))
    expect(kinds(v.items)).toEqual(['user', 'shown', 'agent', 'shown'])
  })

  it('starts a new group after a steered message, and in the next turn', () => {
    const v = foldThread(
      log(...running, shown('a'), prompt('p2', 'And the other?', { steered: true }), shown('b'), { type: 'turn_ended', reason: 'end_turn' }, prompt('p3'), { type: 'turn_started' }, shown('c')),
    )
    expect(kinds(v.items)).toEqual(['user', 'shown', 'user', 'shown', 'user', 'shown'])
    expect(names(v.items[3])).toEqual(['b'])
  })

  it('shows a file logged with no turn open', () => {
    expect(kinds(foldThread(log(shown('a'))).items)).toEqual(['shown'])
  })

  it('goes with the rest when the thread is rewound past it', () => {
    const v = foldThread(log(...running, shown('a'), { type: 'turn_ended', reason: 'end_turn' }, { type: 'rewound', toPromptId: 'p1' }))
    expect(kinds(v.items)).toEqual([])
  })
})

describe('foldThread: words put to the human never fold away', () => {
  const say = (messageId: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId, text })
  const call = (id: string, title: string): ThreadEventBody => ({ type: 'tool', call: { id, kind: 'other', title, status: 'completed' } })
  const running: ThreadEventBody[] = [prompt('p1'), { type: 'process', state: 'running' }, { type: 'turn_started' }]
  const end: ThreadEventBody = { type: 'turn_ended', reason: 'end_turn' }
  const said = (v: ReturnType<typeof foldThread>) => v.items.filter((x) => x.kind === 'agent').map((x) => (x.kind === 'agent' ? x.text : ''))

  it('keeps a question written before wait_for_you in the answer, with the words after it', () => {
    const v = foldThread(
      log(...running, call('c1', 'Read'), say('m1', 'Which model should approvals use?'), call('c2', 'mcp__runcastle__wait_for_you'), say('m2', 'Waiting on you.'), end),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'agent'])
    expect(said(v)).toEqual(['Which model should approvals use?\n\nWaiting on you.'])
    expect(work(v).steps).toMatchObject([{ kind: 'tools', calls: [{ id: 'c1' }] }])
  })

  it('matches a Codex spelling of a talk-only tool too', () => {
    const v = foldThread(log(...running, say('m1', 'Ready for a look.'), call('c1', 'runcastle.declare_ready'), say('m2', 'Drive it when you can.'), end))
    expect(kinds(v.items)).toEqual(['user', 'agent'])
  })

  it('shows a question asked mid-turn where it was asked, before the work that followed it', () => {
    const v = foldThread(log(...running, say('m1', 'Which model should approvals use?'), call('c1', 'Bash'), say('m2', 'Done.'), end))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'work', 'agent'])
    expect(said(v)).toEqual(['Which model should approvals use?', 'Done.'])
    expect(work(v).steps.map((s) => s.kind)).toEqual(['tools'])
  })

  it('keeps words that ask nothing in view too: no word is ever inside a fold', () => {
    const v = foldThread(log(...running, say('m1', 'Running the tests.'), call('c1', 'Bash'), say('m2', 'Done.'), end))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'work', 'agent'])
    expect(said(v)).toEqual(['Running the tests.', 'Done.'])
    expect(work(v).steps.map((s) => s.kind)).toEqual(['tools'])
  })

  it('gives each run of work between words its own fold while the turn runs on, only the newest live', () => {
    const v = foldThread(log(...running, say('m1', 'Should I keep the old route?'), call('c1', 'Bash'), say('m2', 'Meanwhile, tidying.'), call('c2', 'Edit')))
    expect(v.state).toBe('working')
    expect(kinds(v.items)).toEqual(['user', 'agent', 'work', 'agent', 'work'])
    expect(said(v)).toEqual(['Should I keep the old route?', 'Meanwhile, tidying.'])
    expect([work(v, 0).live, work(v, 1).live]).toEqual([undefined, true])
  })

  it('leaves a shown file between the words before it and the words after it', () => {
    const file: ShownFile = { id: 'a', src: '/f/a.png', name: 'a.png', path: 'a.png', size: 1, as: 'image' }
    const v = foldThread(log(...running, say('m1', 'Taking a look.'), call('c1', 'mcp__runcastle__show_file'), { type: 'file_shown', file }, say('m2', 'Merge it?'), end))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'shown', 'agent'])
    expect(said(v)).toEqual(['Taking a look.', 'Merge it?'])
  })

  it('a run between words has its own time, from its first step to the words after it', () => {
    const v = foldThread(
      log(...running, [10_000, say('m1', 'Looking.')], [12_000, call('c1', 'Read')], [20_000, call('c2', 'Bash')], [42_000, say('m2', 'Testing.')], [43_000, call('c3', 'Bash')], [90_000, say('m3', 'Done.')], [91_000, end]),
    )
    expect([work(v, 0).seconds, work(v, 1).seconds]).toEqual([30, 47])
  })

  it("the turn's last words carry the turn's whole time once it ends; earlier words carry none", () => {
    const events = log(prompt('p1'), [5_000, { type: 'turn_started' }], [6_000, say('m1', 'Looking.')], [7_000, call('c1', 'Read')], [9_000, say('m2', 'Done.')])
    const live = foldThread(events)
    expect(live.items.filter((x) => x.kind === 'agent').map((x) => x.kind === 'agent' && x.turnSeconds)).toEqual([undefined, undefined])
    const settled = foldThread([...events, { i: 5, at: 65_000, type: 'turn_ended', reason: 'end_turn' }])
    expect(settled.items.filter((x) => x.kind === 'agent').map((x) => x.kind === 'agent' && x.turnSeconds)).toEqual([undefined, 60])
  })

  it('a turn with no time to tell, as an old chat read back from its transcript, carries no total', () => {
    const v = foldThread(log(prompt('p1'), [5_000, { type: 'turn_started' }], [5_000, say('m1', 'Hello.')], [5_000, end]))
    expect(v.items.at(-1)).toMatchObject({ kind: 'agent', text: 'Hello.' })
    expect(v.items.at(-1)).not.toHaveProperty('turnSeconds')
  })

  it('a run that is only thinking is a run of its own between two stretches of words', () => {
    const v = foldThread(log(...running, say('m1', 'First.'), { type: 'thought', thoughtId: 't1', text: 'Hmm.' }, say('m2', 'Second.'), end))
    expect(kinds(v.items)).toEqual(['user', 'agent', 'work', 'agent'])
    expect(work(v).steps.map((s) => s.kind)).toEqual(['thought'])
  })

  it('keeps every id stable while the turn streams, so what is open stays open', () => {
    const base = [...running, say('m1', 'Look'), call('c1', 'Read'), say('m2', 'Then')]
    const ids = (v: ReturnType<typeof foldThread>) => v.items.map((x) => x.id)
    const a = foldThread(log(...base))
    const b = foldThread(log(...base, { type: 'agent_text', messageId: 'm2', text: ' more' }, call('c2', 'Bash'), end))
    expect(ids(b).slice(0, ids(a).length)).toEqual(ids(a))
    expect(new Set(ids(b)).size).toBe(ids(b).length)
  })
})

describe('foldThread: a chat stored before every word stayed in view', () => {
  // The shape claude-agent-acp logs a multi-step turn in, as stored chats from
  // before this change hold it: each call surfaces pending and untitled, its
  // title follows, then untitled updates until it completes; usage reports
  // fall between; words arrive under message ids between the calls; the turn
  // ends on a question, a wait_for_you and a last line.
  const call = (id: string, title: string, kind: 'read' | 'execute' | 'other' = 'execute'): ThreadEventBody[] => [
    { type: 'tool', call: { id, kind, title: title.split(' ')[0] === 'Read' ? 'Read File' : 'Terminal', status: 'pending' } },
    { type: 'tool', call: { id, title } },
    { type: 'usage', context: { used: 40_000, size: 200_000 } },
    { type: 'tool', call: { id } },
    { type: 'tool', call: { id, status: 'completed' } },
  ]
  const say = (messageId: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId, text })
  const stored = log(
    prompt('p1', 'Is the export broken?'),
    { type: 'process', state: 'running' },
    { type: 'model', model: 'claude-opus-5-5', label: 'Opus 5.5' },
    { type: 'turn_started' },
    { type: 'thought', thoughtId: 'th1', text: 'Look at the export first.' },
    ...call('toolu_1', 'Read src/export.ts', 'read'),
    ...call('toolu_2', 'grep -n exportNote src'),
    say('msg_1', 'The export calls the old name in two places.'),
    say('msg_1', ' Fixing both.'),
    ...call('toolu_3', 'sed -i s/old/new/ src/a.ts'),
    ...call('toolu_4', 'bun test'),
    say('msg_2', 'Tests pass. Should I also rename the route?'),
    ...call('toolu_5', 'mcp__runcastle__wait_for_you', 'other'),
    say('msg_3', 'Waiting on your answer.'),
    { type: 'turn_ended', reason: 'end_turn', files: [{ path: 'src/a.ts', added: 1, removed: 1, lines: [] }] },
  )

  it('shows every message the agent wrote, in order, with each run of work folded between them', () => {
    const v = foldThread(stored)
    expect(kinds(v.items)).toEqual(['user', 'work', 'agent', 'work', 'agent', 'changes'])
    expect(v.items.filter((x) => x.kind === 'agent').map((x) => (x.kind === 'agent' ? x.text : ''))).toEqual([
      'The export calls the old name in two places. Fixing both.',
      'Tests pass. Should I also rename the route?\n\nWaiting on your answer.',
    ])
    expect(work(v, 0).steps.map((s) => s.kind)).toEqual(['thought', 'tools'])
    expect(work(v, 1).steps.flatMap((s) => (s.kind === 'tools' ? s.calls.map((c) => [c.title, c.status]) : []))).toEqual([
      ['sed -i s/old/new/ src/a.ts', 'completed'],
      ['bun test', 'completed'],
    ])
    expect(v.items.every((x) => x.kind !== 'work' || !x.live)).toBe(true)
    expect(v.items.findLast((x) => x.kind === 'agent')).toMatchObject({ id: 'msg_2', model: 'Opus 5.5', turnSeconds: expect.any(Number) })
  })
})

describe('foldThread: subagents across turns and late updates', () => {
  const opened = (id: string, title: string): ThreadEventBody => ({ type: 'subagent', id, title, status: 'in_progress' })
  const finished = (id: string): ThreadEventBody => ({ type: 'subagent', id, status: 'completed' })
  const turnOf = (id: string, ...body: ThreadEventBody[]): ThreadEventBody[] => [prompt(id), { type: 'turn_started' }, ...body, { type: 'turn_ended', reason: 'end_turn' }]

  it('a relaunch re-announcing past subagents makes no cards, as the logged burst reads', () => {
    const v = foldThread(
      log(
        { type: 'process', state: 'running' },
        ...turnOf('p1', opened('s1', 'Summarize the plan'), finished('s1'), { type: 'agent_text', messageId: 'm1', text: 'Done.' }),
        { type: 'process', state: 'stopped' },
        prompt('p2'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        finished('s1'),
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'ls', status: 'completed' } },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(work(v, 0).steps).toMatchObject([{ kind: 'subagent', title: 'Summarize the plan' }])
    expect(work(v, 1).steps).toMatchObject([{ kind: 'tools' }])
  })

  it('an untitled "finished" for a subagent the log never showed makes no card', () => {
    const v = foldThread(log(...turnOf('p1', finished('s1'), { type: 'agent_text', messageId: 'm1', text: 'Done.' })))
    expect(kinds(v.items)).toEqual(['user', 'agent'])
  })

  it('a burst with no turn around it opens none', () => {
    const v = foldThread(log(...turnOf('p1', opened('s1', 'Find it')), finished('s1')))
    expect(v.state).toBe('idle')
    expect(v.items.filter((x) => x.kind === 'work')).toHaveLength(1)
  })

  it('a subagent that runs again in a later turn gets a card there', () => {
    const v = foldThread(log(...turnOf('p1', opened('s1', 'Find it')), ...turnOf('p2', { type: 'subagent', id: 's1', status: 'in_progress' })))
    expect(work(v, 1).steps).toMatchObject([{ kind: 'subagent', status: 'completed' }])
  })

  it('gives that later card a fold id of its own, unique across the thread', () => {
    const again = { type: 'subagent', id: 's1', status: 'in_progress' } as const
    const v = foldThread(log(...turnOf('p1', opened('s1', 'Find it'), finished('s1')), ...turnOf('p2', again, finished('s1'))))
    const ids = v.items.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(v.items.filter((x) => x.kind === 'work')).toHaveLength(2)
  })

  describe('what still runs (the-status-tells-the-truth decision 4)', () => {
    const say = (id: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId: id, text })
    const call = (id: string, title: string): ThreadEventBody => ({ type: 'tool', call: { id, kind: 'other', title, status: 'completed' } })
    const listing = (...agents: Array<{ id: string; title: string; startedAt?: number }>): ThreadEventBody => ({
      type: 'tasks',
      tasks: [],
      agents: agents.map((a) => ({ startedAt: 0, ...a })),
    })
    const works = (v: ReturnType<typeof foldThread>) => v.items.filter((x): x is Extract<ThreadItem, { kind: 'work' }> => x.kind === 'work')

    it('puts the running line on the fold that holds its card, and keeps the card running past the turn', () => {
      const v = foldThread(
        log(
          ...turnOf('p1', call('c0', 'Read spec.md'), say('m1', 'Reading.'), opened('a1', 'Build switcher mocks'), listing({ id: 'a1', title: 'Build switcher mocks' }), say('m2', 'Started it.')),
        ),
      )
      expect(works(v).map((w) => w.running)).toEqual([undefined, { title: 'Build switcher mocks', count: 1 }])
      expect(works(v)[1].steps).toMatchObject([{ kind: 'subagent', id: 'a1', status: 'in_progress' }])
    })

    it("matches a resumed run's card to its task id", () => {
      const v = foldThread(log(...turnOf('p1', opened('a1:generation:2', 'Mocks again'), listing({ id: 'a1', title: '' }), say('m1', 'Resumed.'))))
      expect(work(v).running).toEqual({ title: 'Mocks again', count: 1 })
      expect(work(v).steps).toMatchObject([{ status: 'in_progress' }])
    })

    it('finds the fold by the launching call when no card names it', () => {
      const v = foldThread(
        log(
          ...turnOf('p1', call('c1', 'Agent: Build switcher mocks'), say('m1', 'Launched.'), call('c2', 'Read notes.md'), say('m2', 'Waiting.')),
          [99_000, listing({ id: 'task-9', title: 'Build switcher mocks', startedAt: 99_000 })],
        ),
      )
      expect(works(v).map((w) => w.running)).toEqual([{ title: 'Build switcher mocks', count: 1 }, undefined])
    })

    it('falls back to the newest fold at or before the start, and counts several', () => {
      const v = foldThread(
        log(
          [1_000, prompt('p1')],
          [1_000, { type: 'turn_started' }],
          [2_000, call('c1', 'Read a')],
          [3_000, say('m1', 'One.')],
          [4_000, call('c2', 'Read b')],
          [5_000, say('m2', 'Two.')],
          [9_000, call('c3', 'Read c')],
          [10_000, say('m3', 'Three.')],
          [11_000, { type: 'turn_ended', reason: 'end_turn' }],
          [12_000, listing({ id: 'x', title: 'Draft copy', startedAt: 6_000 }, { id: 'y', title: 'Check links', startedAt: 7_000 })],
        ),
      )
      expect(works(v).map((w) => w.running)).toEqual([undefined, { title: 'Draft copy', count: 2 }, undefined])
    })

    it('completes the card, and drops the line, when the list drops the subagent', () => {
      const events = log(...turnOf('p1', opened('a1', 'Build mocks'), listing({ id: 'a1', title: 'Build mocks' }), say('m1', 'Started it.')))
      const later = log(...turnOf('p1', opened('a1', 'Build mocks'), listing({ id: 'a1', title: 'Build mocks' }), say('m1', 'Started it.')), listing())
      expect(work(foldThread(events)).steps).toMatchObject([{ status: 'in_progress' }])
      const v = foldThread(later)
      expect(work(v).running).toBeUndefined()
      expect(work(v).steps).toMatchObject([{ status: 'completed' }])
    })

    it("hears a held subagent's own end and its calls under its card, with no turn of their own", () => {
      const v = foldThread(
        log(
          ...turnOf('p1', opened('a1', 'Build mocks'), listing({ id: 'a1', title: 'Build mocks' }), say('m1', 'Started it.')),
          { type: 'tool', parentId: 'a1', call: { id: 'g1', kind: 'search', title: 'grep switcher', status: 'completed' } },
          finished('a1'),
        ),
      )
      expect(kinds(v.items)).toEqual(['user', 'work', 'agent'])
      expect(work(v).steps).toMatchObject([{ status: 'completed', calls: [{ id: 'g1', title: 'grep switcher' }] }])
    })

    it('ends a held card when its process stops', () => {
      const v = foldThread(log(...turnOf('p1', opened('a1', 'Build mocks'), listing({ id: 'a1', title: 'Build mocks' }), say('m1', 'Ok.')), { type: 'process', state: 'stopped' }))
      expect(work(v).running).toBeUndefined()
      expect(work(v).steps).toMatchObject([{ status: 'failed' }])
    })
  })

  it('a call finishing after a steered message stays on its row, and the answer stays in view', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'in_progress' } },
        prompt('p2', 'It seems empty', { steered: true }),
        { type: 'agent_text', messageId: 'm1', text: 'Here is my answer.' },
        { type: 'tool', call: { id: 'c1', status: 'completed', output: 'ok' } },
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'user', 'agent'])
    expect(v.items[3]).toMatchObject({ kind: 'agent', text: 'Here is my answer.' })
    expect(work(v).steps).toMatchObject([{ kind: 'tools', calls: [{ title: 'bun test', status: 'completed', output: 'ok' }] }])
  })

  it('a subagent finishing after a steered message stays on its card, and its calls join it', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        opened('s1', 'Find it'),
        prompt('p2', 'also this', { steered: true }),
        { type: 'agent_text', messageId: 'm1', text: 'Answer.' },
        { type: 'tool', parentId: 's1', call: { id: 'c1', kind: 'read', title: 'Read a.ts', status: 'completed' } },
        finished('s1'),
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'user', 'agent'])
    expect(work(v).steps).toMatchObject([{ kind: 'subagent', title: 'Find it', status: 'completed', calls: [{ id: 'c1' }] }])
  })

  it('a call still running at a steered message settles with its turn', () => {
    const v = foldThread(
      log(
        prompt('p1'),
        { type: 'process', state: 'running' },
        { type: 'turn_started' },
        { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun test', status: 'in_progress' } },
        prompt('p2', 'more', { steered: true }),
        { type: 'turn_ended', reason: 'end_turn' },
      ),
    )
    expect(work(v).steps).toMatchObject([{ kind: 'tools', calls: [{ status: 'completed' }] }])
  })

  it('an untitled update for a call of an earlier turn shows nothing and leaves the answer alone', () => {
    const v = foldThread(
      log(
        ...turnOf('p1', { type: 'tool', call: { id: 'c1', kind: 'execute', title: 'bun dev', status: 'in_progress' } }),
        ...turnOf('p2', { type: 'agent_text', messageId: 'm1', text: 'Answer.' }, { type: 'tool', call: { id: 'c1', status: 'completed' } }),
      ),
    )
    expect(kinds(v.items)).toEqual(['user', 'work', 'user', 'agent'])
  })
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

  it('words before a tool call are their own message; the run after them settles the moment words follow it', () => {
    const events = log(
      prompt('p1'),
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm1', text: 'Let me look.' },
      { type: 'tool', call: { id: 'c1', kind: 'read', title: 'a.ts', status: 'in_progress' } },
      { type: 'tool', call: { id: 'c1', status: 'completed' } },
      { type: 'agent_text', messageId: 'm2', text: 'Done.' },
    )
    const live = foldThread(events)
    expect(kinds(live.items)).toEqual(['user', 'agent', 'work', 'agent'])
    const work = live.items[2] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.live).toBeUndefined()
    expect(work.seconds).toBe(2)
    expect(work.steps.map((s) => s.kind)).toEqual(['tools'])
    expect(live.state).toBe('working')

    const settled = foldThread([...events, { i: 6, at: 223_000, type: 'turn_ended', reason: 'end_turn' }])
    expect(settled.items).toEqual(live.items.map((x) => (x.kind === 'agent' && x.text === 'Done.' ? { ...x, turnSeconds: 222 } : x)))
    expect(settled.items[1]).toMatchObject({ kind: 'agent', text: 'Let me look.' })
    expect(settled.items[3]).toMatchObject({ kind: 'agent', text: 'Done.', turnSeconds: 222 })
  })

  it('streaming words never move: a tool call after them opens a live run below them', () => {
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
    expect(kinds(after.items)).toEqual(['user', 'agent', 'work'])
    expect(after.items[1].id).toBe(before.items[1].id)
    expect((after.items[2] as Extract<ThreadItem, { kind: 'work' }>).live).toBe(true)
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
    expect(kinds(answered.items)).toEqual(['user', 'agent', 'work', 'answered', 'agent'])
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
    // Before the words after it, the run stays live with its approved command running, its answers below it.
    const running = foldThread(events.slice(0, -1))
    expect(kinds(running.items)).toEqual(['user', 'agent', 'work', 'answered', 'answered', 'answered'])
    expect((running.items[2] as Extract<ThreadItem, { kind: 'work' }>).live).toBe(true)

    const live = foldThread(events)
    expect(kinds(live.items)).toEqual(['user', 'agent', 'work', 'answered', 'answered', 'answered', 'agent'])

    const settled = foldThread([...events, { i: events.length, at: 99_000, type: 'turn_ended', reason: 'end_turn' }])
    expect(kinds(settled.items)).toEqual(['user', 'agent', 'work', 'answered', 'answered', 'answered', 'agent'])
    const work = settled.items[2] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.live).toBeUndefined()
    expect(work.steps.map((s) => s.kind)).toEqual(['tools', 'tools', 'tools'])
    const calls = work.steps.flatMap((s) => (s.kind === 'tools' ? s.calls : []))
    expect(calls.map((c) => [c.title, c.status])).toEqual([
      ['bun install', 'completed'],
      ['bun run build', 'completed'],
      ['git init', 'completed'],
    ])
    expect(settled.items[6]).toMatchObject({ kind: 'agent', text: 'All set.' })
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

  // lead-chats-stay-small decisions 6, 11
  it('the divider says why runcastle compacted, and the context size before it and after it', () => {
    const usage = (used: number): ThreadEventBody => ({ type: 'usage', context: { used, size: 1_000_000 } })
    const run = (...body: ThreadEventBody[]) => foldThread(log(...body)).items.find((x) => x.kind === 'compacted')
    const auto = prompt('c1', '/compact Keep …', { source: 'runcastle', hidden: true, compaction: 'idle' })
    expect(run(usage(231_000), auto, { type: 'turn_started' }, { type: 'compacted', trigger: 'idle', before: 231_000 }, usage(64_000))).toEqual({
      kind: 'compacted',
      id: 'compacted:3',
      trigger: 'idle',
      before: 231_000,
      after: 64_000,
    })
    // An older log's Compact now: a bare event in the hidden `/compact` turn reads as the human's, with the sizes the reports give.
    expect(run(usage(90_000), prompt('c1', '/compact', { source: 'runcastle', hidden: true }), { type: 'compacted' }, usage(8_000))).toMatchObject({
      trigger: 'manual',
      before: 90_000,
      after: 8_000,
    })
    // The runtime's own, inside a long turn: no reason; no after until a report comes.
    expect(run(prompt('p1', 'Build it'), { type: 'turn_started' }, usage(200_000), { type: 'compacted' })).toEqual({ kind: 'compacted', id: 'compacted:3', before: 200_000 })
    // A message sent while a compaction runs does not take its reason away.
    expect(run(auto, { type: 'turn_started' }, prompt('p2', 'Hello'), { type: 'compacted', trigger: 'idle' })).toMatchObject({ trigger: 'idle' })
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
    // A compaction's reason and size are optional: an older log's bare one still parses.
    expect(ThreadEvent.parse({ i: 1, at: 2, type: 'compacted' })).toEqual({ i: 1, at: 2, type: 'compacted' })
    const told = { i: 2, at: 3, type: 'compacted', trigger: 'planned', before: 231_000 }
    expect(ThreadEvent.parse(told)).toEqual(told)
    expect(() => ThreadEvent.parse({ ...told, trigger: 'whenever' })).toThrow()
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

/** Whether the thread waits on the human, with no background work in these logs to weigh. */
const awaitsHuman = (events: readonly ThreadEvent[], running: boolean): boolean => ['asking', 'replied'].includes(threadActivity(events, running, 0))

describe('threadActivity and held prompts (agents-are-woken-only-when-it-matters decision 2)', () => {
  const line = (body: ThreadEventBody, i: number): ThreadEvent => ({ ...body, i, at: 1_000 }) as ThreadEvent
  const replied = [
    { type: 'prompt', id: 'p1', text: 'Plan it', source: 'human' },
    { type: 'turn_started' },
    { type: 'agent_text', messageId: 'm1', text: 'Shall I start round 1?' },
    { type: 'turn_ended', reason: 'end_turn' },
  ] as ThreadEventBody[]

  it('still waits on the human after a held line arrives, since it answers nothing', () => {
    const held = { type: 'prompt', id: 'p2', text: '[runcastle] The human pressed Stop.', source: 'runcastle', held: true } as ThreadEventBody
    expect(threadActivity([...replied, held].map(line), true, 1_000)).toBe('replied')
  })

  it('stops waiting once a prompt that is not held arrives', () => {
    const sent = { type: 'prompt', id: 'p2', text: 'Yes', source: 'human' } as ThreadEventBody
    expect(threadActivity([...replied, sent].map(line), true, 1_000)).not.toBe('replied')
  })
})

describe('threadActivity with background work', () => {
  const at = 1_000
  const line = (body: ThreadEventBody, i: number, when = at): ThreadEvent => ({ ...body, i, at: when }) as ThreadEvent
  const reply = (words: string): ThreadEvent[] =>
    (
      [
        { type: 'prompt', id: 'p1', text: 'Run the tests', source: 'human' },
        { type: 'turn_started' },
        { type: 'agent_text', messageId: 'm1', text: words.slice(0, 4) },
        { type: 'agent_text', messageId: 'm1', text: words.slice(4) },
        { type: 'tasks', tasks: [{ id: 'b1', title: 'bun test', startedAt: at }] },
        { type: 'turn_ended', reason: 'end_turn' },
      ] as ThreadEventBody[]
    ).map((body, i) => line(body, i))
  const soon = at + 60_000

  it('reads a reply with a command still running as background work, not as waiting', () => {
    expect(threadActivity(reply('Tests are running; I will commit once green.'), true, soon)).toBe('background')
  })

  it('goes back to waiting once the window has passed, whatever still runs', () => {
    const log = reply('Tests are running.')
    expect(threadActivity(log, true, at + BACKGROUND_WINDOW_MS - 1)).toBe('background')
    expect(threadActivity(log, true, at + BACKGROUND_WINDOW_MS)).toBe('replied')
  })

  it('waits on the human at once when the reply ends on a question', () => {
    expect(threadActivity(reply('The server is up. Shall I carry on?'), true, soon)).toBe('replied')
    expect(threadActivity(reply('Which do you want: **A or B?**'), true, soon)).toBe('replied')
    expect(threadActivity(reply('هل تريد المتابعة؟'), true, soon)).toBe('replied')
    expect(threadActivity(reply('I asked why? Because it failed.'), true, soon)).toBe('background')
  })

  it('weighs only what the latest turn said, not a question an earlier turn asked', () => {
    const log = [
      { type: 'prompt', id: 'p1', text: 'Go', source: 'human' },
      { type: 'turn_started' },
      { type: 'agent_text', messageId: 'm1', text: 'Which do you prefer?' },
      { type: 'turn_ended', reason: 'end_turn' },
      { type: 'prompt', id: 'p2', text: 'The first', source: 'human' },
      { type: 'turn_started' },
      { type: 'tasks', tasks: [{ id: 'b1', title: 'bun test', startedAt: at }] },
      { type: 'turn_ended', reason: 'end_turn' },
    ] as ThreadEventBody[]
    expect(threadActivity(log.map((body, i) => line(body, i)), true, soon)).toBe('background')
  })

  it('waits on the human when an ask is open, whatever runs', () => {
    const ask: ThreadEventBody = { type: 'ask', ask: { kind: 'question', id: 'a1', questions: [] } }
    expect(threadActivity([...reply('Running.'), line(ask, 6)], true, soon)).toBe('asking')
  })

  it('waits on the human once the work is over and the agent did not pick up', () => {
    const over = line({ type: 'tasks', tasks: [] }, 6)
    expect(threadActivity([...reply('Running.'), over], true, soon)).toBe('replied')
  })

  it('counts a sub-agent left running in the background', () => {
    const log = reply('Running.').map((e) => (e.type === 'tasks' ? { ...e, tasks: [], agents: 1 } : e))
    expect(threadActivity(log, true, soon)).toBe('background')
  })

  describe('a listed subagent (the-status-tells-the-truth decision 3)', () => {
    const AGENT = { id: 'a1', title: 'Build switcher direction mocks', startedAt: at }
    const withAgents = (agents: Extract<ThreadEventBody, { type: 'tasks' }>['agents'], tasks: boolean) =>
      reply('Waiting on the subagent.').map((e) => (e.type === 'tasks' ? { ...e, ...(tasks ? {} : { tasks: [] }), agents } : e))

    it('keeps the thread working past the 10-minute window, for as long as it is listed', () => {
      const log = withAgents([AGENT], false)
      expect(threadActivity(log, true, at + BACKGROUND_WINDOW_MS)).toBe('background')
      expect(threadActivity(log, true, at + 6 * BACKGROUND_WINDOW_MS)).toBe('background')
      expect(threadActivity([...log, line({ type: 'tasks', tasks: [], agents: [] }, 6)], true, at + BACKGROUND_WINDOW_MS)).toBe('replied')
    })

    it('leaves a background command alone capped at the window', () => {
      const log = withAgents([], true)
      expect(threadActivity(log, true, at + BACKGROUND_WINDOW_MS - 1)).toBe('background')
      expect(threadActivity(log, true, at + BACKGROUND_WINDOW_MS)).toBe('replied')
    })

    it('loses to a question: an open ask, or a reply ending on one', () => {
      const ask: ThreadEventBody = { type: 'ask', ask: { kind: 'question', id: 'q1', questions: [] } }
      expect(threadActivity([...withAgents([AGENT], false), line(ask, 6)], true, at + BACKGROUND_WINDOW_MS)).toBe('asking')
      const asked = reply('Mocks are building. Want the dark one too?').map((e) => (e.type === 'tasks' ? { ...e, agents: [AGENT] } : e))
      expect(threadActivity(asked, true, soon)).toBe('replied')
    })

    it("reads an older log's bare count as that many running, with no cap", () => {
      const log = withAgents(3, false)
      expect(runningSubagents(log.find((e) => e.type === 'tasks') as Extract<ThreadEvent, { type: 'tasks' }>)).toHaveLength(3)
      expect(threadActivity(log, true, at + 2 * BACKGROUND_WINDOW_MS)).toBe('background')
    })

    it('stops counting when the process stops', () => {
      const stopped = line({ type: 'process', state: 'stopped' }, 6)
      expect(threadActivity([...withAgents([AGENT], false), stopped], true, soon)).toBe('replied')
    })

    // Claude Code keeps the turn open until its background subagents end, though its Stop hook already fired.
    describe('in a turn held open by it', () => {
      const open = (words: string) =>
        reply(words)
          .filter((e) => e.type !== 'turn_ended')
          .map((e) => (e.type === 'tasks' ? { ...e, tasks: [], agents: [AGENT] } : e))

      it('reads as background work, for as long as it is listed', () => {
        expect(threadActivity(open('launched.'), true, at + 6 * BACKGROUND_WINDOW_MS)).toBe('background')
        expect(threadActivity([...open('launched.'), line({ type: 'tasks', tasks: [], agents: [] }, 6)], true, soon)).toBe('turn')
      })

      it('stays a plain turn when the words end on a question, or the process is gone', () => {
        expect(threadActivity(open('Mocks are building. Want the dark one too?'), true, soon)).toBe('turn')
        expect(threadActivity(open('launched.'), false, soon)).toBe('turn')
      })
    })
  })

  it('takes no background work from a process that is not running', () => {
    expect(threadActivity(reply('Running.'), false, soon)).toBe('replied')
    const stopped = line({ type: 'process', state: 'stopped' }, 6)
    expect(threadActivity([...reply('Running.'), stopped], true, soon)).toBe('replied')
  })

  it('leaves a turn the human stopped as no reply', () => {
    const log = reply('Running.').map((e) => (e.type === 'turn_ended' ? { ...e, reason: 'cancelled' as const } : e))
    expect(threadActivity(log, true, soon)).toBe('idle')
  })

  it('reads a turn the agent started by itself as a turn', () => {
    const woke = line({ type: 'turn_started', source: 'agent' }, 6)
    expect(threadActivity([...reply('Running.'), woke], true, soon)).toBe('turn')
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

  // lead-chats-stay-small decision 14: a compaction at a quiet moment moves nothing the human waits on.
  it('a compaction neither answers the reply before it nor makes one, while it runs or after', () => {
    const compact = prompt('c1', '/compact Keep …', { source: 'runcastle', hidden: true, compaction: 'idle' })
    const replied = [prompt('p1'), started, said, ended]
    expect(awaitsHuman(log(...replied, compact, started), true)).toBe(true)
    expect(awaitsHuman(log(...replied, compact, started, { type: 'compacted', trigger: 'idle' }, ended), true)).toBe(true)
    expect(awaitsHuman(log(...replied, compact, started, ended, stopped), false)).toBe(true)
    // An older log's Compact now too.
    expect(awaitsHuman(log(...replied, prompt('c2', '/compact', { source: 'runcastle', hidden: true }), started, ended), true)).toBe(true)
    // Nothing waited before it: nothing waits after it.
    expect(awaitsHuman(log(compact, started, ended), true)).toBe(false)
    // The human's message sent meanwhile answers the reply, and its own turn is the next reply.
    expect(awaitsHuman(log(...replied, compact, started, prompt('p2'), ended), true)).toBe(false)
    expect(awaitsHuman(log(...replied, compact, started, prompt('p2'), ended, started, said, ended), true)).toBe(true)
  })

  it('an empty thread waits on nobody', () => {
    expect(awaitsHuman([], false)).toBe(false)
  })
})

describe('featuresAskedAbout (every-feature-has-one-owner decision 17)', () => {
  const turn = (words: string, ...cards: ThreadEventBody[]): ThreadEventBody[] => [
    { type: 'turn_started' },
    ...cards,
    { type: 'agent_text', messageId: `m${words.length}`, text: words },
    { type: 'turn_ended', reason: 'end_turn' },
  ]
  const plan = (featureId: string): ThreadEventBody => ({ type: 'plan_shown', featureId })
  const design = (featureId: string, designId = 'd1'): ThreadEventBody => ({ type: 'design_shown', designId, featureId })
  const review = (featureId: string): ThreadEventBody => ({ type: 'review_package', ticketId: 't1', featureId })
  const asked = (...bodies: ThreadEventBody[]) => featuresAskedAbout(log(...bodies), true, 100_000)

  it('names the features whose cards the turn showed when it ended on a question', () => {
    expect(asked(prompt('p1'), ...turn('Approve these, or change them?', plan('f1'), design('f2'), review('f3'), design('f2', 'd2')))).toEqual(['f1', 'f2', 'f3'])
  })

  it('names nothing when the turn asked nothing, or showed no card', () => {
    expect(asked(prompt('p1'), ...turn('Plan posted. Round 1 is running.', plan('f1')))).toEqual([])
    expect(asked(prompt('p1'), ...turn('Which should go first?'))).toEqual([])
  })

  it('reads a question followed by a recommendation as asking', () => {
    expect(asked(prompt('p1'), ...turn('Should I start that drive when it is ready? I recommend yes.', review('f1')))).toEqual(['f1'])
  })

  it('reads a question with no question mark as asking nothing', () => {
    expect(asked(prompt('p1'), ...turn('Approve the plan in the card, or tell me what to change.', plan('f1')))).toEqual([])
  })

  it('weighs only the last turn: a card an earlier turn showed does not count', () => {
    expect(asked(prompt('p1'), ...turn('Does this look right?', plan('f1')), prompt('p2', 'Yes'), ...turn('Next, the design?', design('f2')))).toEqual(['f2'])
  })

  it('names nothing once the human has answered, or while the chat works', () => {
    expect(asked(prompt('p1'), ...turn('Does this look right?', plan('f1')), prompt('p2', 'Yes'))).toEqual([])
    expect(asked(prompt('p1'), { type: 'turn_started' }, plan('f1'), { type: 'agent_text', messageId: 'm1', text: 'Shall I?' })).toEqual([])
  })

  it('still names them after a held line arrives, since it answers nothing', () => {
    const held: ThreadEventBody = { type: 'prompt', id: 'p2', text: '[runcastle] note', source: 'runcastle', held: true }
    expect(asked(prompt('p1'), ...turn('Approve it?', plan('f1')), held)).toEqual(['f1'])
  })

  it('names the cards shown so far while an ask is open mid-turn', () => {
    const ask: ThreadEventBody = { type: 'ask', ask: { kind: 'question', id: 'a1', questions: [] } }
    expect(asked(prompt('p1'), { type: 'turn_started' }, review('f3'), ask)).toEqual(['f3'])
  })

  it('still names them once the chat process has stopped (decision 22: it still owns them)', () => {
    expect(featuresAskedAbout(log(prompt('p1'), ...turn('Merge it?', review('f3')), { type: 'process', state: 'stopped' }), false, 100_000)).toEqual(['f3'])
  })

  it('ignores a card from an older log that names no feature', () => {
    expect(asked(prompt('p1'), ...turn('Approve it?', { type: 'plan_shown' }))).toEqual([])
  })
})
