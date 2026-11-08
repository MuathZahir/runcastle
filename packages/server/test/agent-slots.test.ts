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
