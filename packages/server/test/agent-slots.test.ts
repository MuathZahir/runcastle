import { describe, expect, it } from 'vitest'
import { createAgentSlots } from '../src/services/agent-slots'

/** The account hold on the shared slots (burns-become-workers decision 21). */
describe('an account hold', () => {
  it('grants no slot to a turn on the held runtime, lets other runtimes by, and admits the held ones once lifted', async () => {
    const slots = createAgentSlots(2)
    slots.hold('claude-code', 'Invalid API key')
    expect(slots.tryTake('claude-code')).toBeUndefined()
    expect(slots.holdOf('claude-code')).toBe('Invalid API key')

    const order: string[] = []
    void slots.take('claude-code').then(() => order.push('claude'))
    const codex = slots.tryTake('codex')
    expect(codex).toBeDefined()
    await Promise.resolve()
    expect(order).toEqual([])

    expect(slots.lift()).toBe(true)
    await Promise.resolve()
    expect(order).toEqual(['claude'])
    expect(slots.holdOf('claude-code')).toBeUndefined()
    expect(slots.lift()).toBe(false)
  })

  it('keeps the first reason when held again', () => {
    const slots = createAgentSlots(1)
    slots.hold('codex', 'not logged in')
    slots.hold('codex', 'insufficient_quota')
    expect(slots.holdOf('codex')).toBe('not logged in')
  })
})

/** The line-up read back (one-number-for-how-many-build-at-once decisions 3 and 9). */
describe('the snapshot', () => {
  it('lists holders in order of admission and waiters in the order they asked, whoever they belong to', async () => {
    let t = 100
    const slots = createAgentSlots(2, () => {}, () => t++)
    const a = slots.tryTake('claude-code', 'w-a')!
    slots.tryTake('codex', 'w-b')
    void slots.take('claude-code', 'w-c')
    void slots.take('codex', 'w-d')

    expect(slots.snapshot()).toEqual({
      limit: 2,
      holding: [
        { holder: 'w-a', since: 100 },
        { holder: 'w-b', since: 101 },
      ],
      waiting: [
        { holder: 'w-c', since: 102 },
        { holder: 'w-d', since: 103 },
      ],
    })

    a()
    await Promise.resolve()
    const after = slots.snapshot()
    expect(after.holding.map((h) => h.holder)).toEqual(['w-b', 'w-c'])
    expect(after.waiting.map((w) => w.holder)).toEqual(['w-d'])
  })

  it('keeps a waiter on a held runtime in its place, says why, and lets the next one by', async () => {
    const slots = createAgentSlots(1)
    const first = slots.tryTake('codex', 'w-a')!
    void slots.take('claude-code', 'w-held')
    void slots.take('codex', 'w-next')
    slots.hold('claude-code', 'usage limit')

    expect(slots.snapshot().waiting).toEqual([
      { holder: 'w-held', since: expect.any(Number), heldBy: 'usage limit' },
      { holder: 'w-next', since: expect.any(Number) },
    ])

    first()
    await Promise.resolve()
    expect(slots.snapshot().holding.map((h) => h.holder)).toEqual(['w-next'])
    expect(slots.snapshot().waiting.map((w) => w.holder)).toEqual(['w-held'])
  })

  it('reports the retuned limit, and a raise admits the next in line', async () => {
    const slots = createAgentSlots(1)
    slots.tryTake(undefined, 'w-a')
    void slots.take(undefined, 'w-b')
    slots.resize(3)
    await Promise.resolve()
    expect(slots.snapshot()).toMatchObject({ limit: 3, waiting: [] })
    expect(slots.snapshot().holding.map((h) => h.holder)).toEqual(['w-a', 'w-b'])
  })

  it('lets a waiter withdraw: it leaves the line at once, holding nothing, and the next keeps its turn', async () => {
    let moves = 0
    const slots = createAgentSlots(1, () => moves++)
    const a = slots.tryTake(undefined, 'w-a')!
    const withdraw = new AbortController()
    const gone = slots.take(undefined, 'w-gone', withdraw.signal)
    const next = slots.take(undefined, 'w-next')
    const before = moves

    withdraw.abort()
    expect(moves).toBe(before + 1)
    expect(slots.snapshot().waiting.map((w) => w.holder)).toEqual(['w-next'])
    ;(await gone)() // a release that does nothing
    expect(slots.held()).toBe(1)

    a()
    await next
    expect(slots.snapshot().holding.map((h) => h.holder)).toEqual(['w-next'])
    withdraw.abort() // aborting again does nothing
    await expect(slots.take(undefined, 'late', withdraw.signal)).resolves.toBeTypeOf('function')
    expect(slots.waiting()).toBe(0)
  })

  it('says the line-up moved on every grant, release, wait, retune, hold and lift', () => {
    let moves = 0
    const slots = createAgentSlots(1, () => moves++)
    const a = slots.tryTake(undefined, 'w-a')! // grant
    void slots.take(undefined, 'w-b') // wait
    expect(moves).toBe(2)
    a() // release, admitting w-b: one move
    expect(moves).toBe(3)
    slots.resize(2)
    slots.resize(2) // unchanged: no move
    slots.hold('codex', 'x')
    slots.hold('codex', 'y') // already held: no move
    slots.lift()
    expect(moves).toBe(6)
    a() // a second release does nothing
    expect(moves).toBe(6)
  })
})
