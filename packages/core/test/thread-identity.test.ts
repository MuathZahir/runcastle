import { describe, expect, it } from 'vitest'
import { foldThread, keepItemIdentity, type ThreadEvent, type ThreadEventBody } from '../src/thread'

/**
 * A streamed chunk changes one item (a-faster-web-app, "Fix typing"): folding
 * the log again and keeping the earlier copies of what did not change lets the
 * chat redraw only that item.
 */

const log = (...bodies: ThreadEventBody[]): ThreadEvent[] => bodies.map((b, i) => ({ i, at: i * 1000, ...b }) as ThreadEvent)

const turn = (n: number): ThreadEventBody[] => [
  { type: 'prompt', id: `p${n}`, text: `question ${n}`, source: 'human' },
  { type: 'turn_started' },
  { type: 'agent_text', messageId: `m${n}`, text: `answer ${n}` },
  { type: 'turn_ended', reason: 'end_turn' },
]

const history: ThreadEventBody[] = [{ type: 'process', state: 'running' }, ...[1, 2, 3].flatMap(turn)]
const streaming: ThreadEventBody[] = [
  ...history,
  { type: 'prompt', id: 'p4', text: 'question 4', source: 'human' },
  { type: 'turn_started' },
  { type: 'agent_text', messageId: 'm4', text: 'first words ' },
]

describe('keepItemIdentity', () => {
  it('keeps every unchanged item’s identity when a chunk appends, and changes only the item it grew', () => {
    const before = foldThread(log(...streaming)).items
    const fresh = foldThread(log(...streaming, { type: 'agent_text', messageId: 'm4', text: 'more words' })).items
    const kept = keepItemIdentity(before, fresh)

    expect(kept).toEqual(fresh)
    expect(kept).not.toBe(before)
    const grown = kept.findIndex((x) => x.kind === 'agent' && x.text.includes('more words'))
    expect(grown).toBe(kept.length - 1)
    kept.forEach((item, n) => {
      if (n === grown) expect(item).not.toBe(before[n])
      else expect(item).toBe(before[n])
    })
  })

  it('answers the earlier list itself when the fold made nothing new', () => {
    const before = foldThread(log(...history)).items
    const again = foldThread(log(...history, { type: 'usage', context: { used: 10, size: 100 } })).items
    expect(again).not.toBe(before)
    expect(keepItemIdentity(before, again)).toBe(before)
  })

  it('keeps items moved by an id, and takes new ones as they come', () => {
    const before = foldThread(log(...history)).items
    const next = [{ kind: 'notice' as const, id: 'n', text: 'hello' }, ...foldThread(log(...history)).items]
    const kept = keepItemIdentity(before, next)
    expect(kept[0]).toBe(next[0])
    kept.slice(1).forEach((item, n) => expect(item).toBe(before[n]))
  })
})
