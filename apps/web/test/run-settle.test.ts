// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTLE_MS, useSuccessSettle } from '../src/lib/use-success-settle'
import { runHeadline } from '../src/lib/feature-ui/run'

/**
 * Decision #15a — a run watched to success is seen to succeed before the page
 * changes. Tier 2, because the whole behaviour is a timer over a sequence of
 * renders: no markup can show that the body swap waited, only that it did.
 */
describe('useSuccessSettle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  const run = (status: string) => ({ id: 'r1', status }) as Parameters<typeof useSuccessSettle>[0]

  it('holds a watched run for the beat, then releases it', () => {
    const { result, rerender } = renderHook(({ status }) => useSuccessSettle(run(status)), {
      initialProps: { status: 'running' },
    })
    expect(result.current).toBeNull()

    rerender({ status: 'succeeded' })
    expect(result.current).toBe('r1')

    act(() => void vi.advanceTimersByTime(SETTLE_MS))
    expect(result.current).toBeNull()
  })

  it('skips the beat for a run that had already finished when the page mounted', () => {
    const { result } = renderHook(() => useSuccessSettle(run('succeeded')))
    expect(result.current).toBeNull()
  })

  /** Only success settles — a failure or a cancel has something to read, now. */
  it('never holds a run that failed or was cancelled', () => {
    for (const status of ['failed', 'cancelled']) {
      const { result, rerender } = renderHook(({ s }) => useSuccessSettle(run(s)), {
        initialProps: { s: 'running' },
      })
      rerender({ s: status })
      expect(result.current).toBeNull()
      cleanup()
    }
  })

  it('does not replay the beat on a later re-render of the same finished run', () => {
    const { result, rerender } = renderHook(({ status }) => useSuccessSettle(run(status)), {
      initialProps: { status: 'running' },
    })
    rerender({ status: 'succeeded' })
    act(() => void vi.advanceTimersByTime(SETTLE_MS))
    rerender({ status: 'succeeded' })
    expect(result.current).toBeNull()
  })
})

describe('the all-green beat headline', () => {
  it('says every lane landed when a run succeeded with nothing outstanding', () => {
    const landed = [
      { seq: 1, status: 'done' },
      { seq: 2, status: 'done' },
      { seq: 3, status: 'done', kind: 'review' },
    ]
    expect(runHeadline(landed, { status: 'succeeded' })).toBe('All 3 tickets landed ✓')
    expect(runHeadline([{ seq: 1, status: 'done' }], { status: 'succeeded' })).toBe(
      'All 1 ticket landed ✓',
    )
  })

  it('withholds it whenever a lane did not land, or the run is still going', () => {
    const mixed = [
      { seq: 1, status: 'done' },
      { seq: 2, status: 'cancelled' },
    ]
    expect(runHeadline(mixed, { status: 'succeeded' })).toContain('1 waived')
    expect(runHeadline([{ seq: 1, status: 'done' }], { status: 'running' })).toBe(
      'Burning 1 ticket · 1 done',
    )
  })
})
