import { describe, expect, it } from 'vitest'
import { approvalProgress, nextWaiting, oldestWaiting, type DesignEntry } from '../src/lib/feature-ui/designs'

/**
 * Where Approve & next goes and how far the human is
 * (designs-and-the-plan-get-their-own-place decisions 24, 25).
 */
const design = (id: string, shownAt: number, state: DesignEntry['state'] = 'waiting'): DesignEntry => ({
  id,
  title: id,
  path: `/${id}`,
  state,
  isNew: false,
  shownAt,
  report: null,
})

// The list's order: waiting newest first (c, b, a), then approved (d), then dropped (e).
const DESIGNS = [design('a', 1), design('b', 2), design('c', 3), design('d', 4, 'approved'), design('e', 5, 'dropped')]

describe('nextWaiting', () => {
  it('is the next waiting design after the open one in the list’s order', () => {
    expect(nextWaiting(DESIGNS, 'c')?.id).toBe('b')
    expect(nextWaiting(DESIGNS, 'b')?.id).toBe('a')
  })

  it('wraps round to the first waiting design', () => {
    expect(nextWaiting(DESIGNS, 'a')?.id).toBe('c')
    expect(nextWaiting(DESIGNS, 'd')?.id).toBe('c')
  })

  it('is null when no other design waits, so the view returns to the list', () => {
    expect(nextWaiting([design('a', 1), design('d', 4, 'approved')], 'a')).toBeNull()
  })
})

describe('oldestWaiting', () => {
  it('is the waiting design shown earliest, whatever the order given — what the phone’s Design to approve opens', () => {
    expect(oldestWaiting([design('c', 3), design('x', 0, 'approved'), design('a', 1), design('b', 2)])?.id).toBe('a')
  })

  it('is null when no design waits', () => {
    expect(oldestWaiting([design('d', 4, 'approved'), design('e', 5, 'dropped')])).toBeNull()
  })
})

describe('approvalProgress', () => {
  it('counts approved designs among those not dropped', () => {
    expect(approvalProgress(DESIGNS)).toEqual({ approved: 1, total: 4, done: false })
  })

  it('is done once every design not dropped is approved, and never for an empty list', () => {
    expect(approvalProgress([design('d', 4, 'approved'), design('e', 5, 'dropped')])).toEqual({ approved: 1, total: 1, done: true })
    expect(approvalProgress([]).done).toBe(false)
  })
})
