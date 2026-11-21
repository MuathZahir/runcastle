import { describe, expect, it } from 'vitest'
import {
  lastTurnAnsweredHuman,
  projectQuiet,
  quietAlertDue,
  quietAlertLine,
  quietReasonWords,
  type QuietFeature,
  type QuietSnapshot,
  type ThreadEvent,
} from '../src'

/** Runcastle says when nothing is running: the rule, snapshot in, line out. */

const f = (over: Partial<QuietFeature> = {}): QuietFeature => ({
  title: 'Search',
  running: false,
  yourMove: false,
  reason: { kind: 'unknown' },
  ...over,
})
const snap = (features: QuietFeature[], over: Partial<QuietSnapshot> = {}): QuietSnapshot => ({
  features,
  otherRunning: false,
  needsYou: false,
  ...over,
})
const at = () => '14:05'

describe('the quiet rule', () => {
  it.each<[string, QuietSnapshot, boolean]>([
    ['a stopped feature, nothing else', snap([f()]), true],
    ['no started features', snap([]), false],
    ['a feature running', snap([f(), f({ running: true })]), false],
    ['an orchestrator chat or a drive running', snap([f()], { otherRunning: true }), false],
    ['anything in Needs you', snap([f()], { needsYou: true }), false],
    ['only features that are the human’s move', snap([f({ yourMove: true })]), false],
    ['a stopped feature beside one that is the human’s move', snap([f({ yourMove: true }), f()]), true],
  ])('%s → due %s', (_, s, due) => {
    expect(quietAlertDue(s)).toBe(due)
    expect(quietAlertLine(s, at) !== null).toBe(due)
  })

  it('reads a project with only the human’s move as quiet, though it raises nothing', () => {
    expect(projectQuiet(snap([f({ yourMove: true })]))).toBe(true)
  })

  it('says why, feature by feature', () => {
    const line = quietAlertLine(
      snap([
        f({ title: 'Search', reason: { kind: 'limit', until: 0 } }),
        f({ title: ' Header ', reason: { kind: 'worker' } }),
        f({ title: 'Mine', yourMove: true }),
      ]),
      at,
    )
    expect(line).toBe(
      'Nothing is running: 2 features stopped. Search: held for the usage limit until 14:05. Header: a worker stopped mid-assignment.',
    )
    expect(quietAlertLine(snap([f()]), at)).toBe('Nothing is running: 1 feature stopped. Search: stopped after its last turn.')
  })

  it.each<[Parameters<typeof quietReasonWords>[0], string]>([
    [{ kind: 'limit', until: 0 }, 'held for the usage limit until 14:05'],
    [{ kind: 'worker' }, 'a worker stopped mid-assignment'],
    [{ kind: 'worker', stalled: true }, 'a worker stalled'],
    [{ kind: 'merge' }, 'ready and waiting on a merge'],
    [{ kind: 'unknown' }, 'stopped after its last turn'],
  ])('words %o as "%s"', (reason, words) => {
    expect(quietReasonWords(reason, at)).toBe(words)
  })
})

describe('whether the last turn answered the human', () => {
  let i = 0
  const ev = (body: Record<string, unknown>) => ({ i: i++, at: i, ...body }) as unknown as ThreadEvent
  const prompt = (source: 'human' | 'runcastle', more: Record<string, unknown> = {}) =>
    ev({ type: 'prompt', id: `p${i}`, text: 'x', source, ...more })
  const turn = () => [ev({ type: 'turn_started' }), ev({ type: 'turn_ended', reason: 'end_turn' })]

  it.each<[string, ThreadEvent[], boolean]>([
    ['no prompt yet', [], false],
    ['the human wrote last', [prompt('human'), ...turn()], true],
    ['runcastle sent the last prompt (a handback, a wake)', [prompt('human'), ...turn(), prompt('runcastle'), ...turn()], false],
    ['a held line rode no turn', [prompt('human'), ...turn(), prompt('runcastle', { held: true })], true],
    ['a hidden command answers nobody', [prompt('human'), ...turn(), prompt('human', { hidden: true }), ...turn()], true],
    [
      'a turn the agent started by itself carries on the human’s',
      [prompt('human'), ...turn(), ev({ type: 'turn_started', source: 'agent' }), ev({ type: 'turn_ended', reason: 'end_turn' })],
      true,
    ],
  ])('%s → %s', (_, events, answered) => {
    expect(lastTurnAnsweredHuman(events)).toBe(answered)
  })
})
