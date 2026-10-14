// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { useResumeFailedBanner } from '../src/components/workspace/use-resume-failed-alert'

const BACKGROUND_MESSAGE =
  'resume failed for chat — the session exited before starting (code 1): its conversation is running as a ' +
  'Claude Code background session (3f2a9c71), which cannot be resumed here. Run `claude attach 3f2a9c71` to ' +
  'look at it, then `claude stop 3f2a9c71` (stopping keeps the conversation), then relaunch.'

function event(id: number, type: string, message = '', data?: unknown): EventRow {
  return { id, projectId: 'p1', featureId: 'feat_a', ts: id, type, message, data }
}

const history = [event(1, 'session.started')]

describe('resume-failed banner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the background-session way out up until it is dismissed', () => {
    const { result, rerender } = renderHook(({ events }) => useResumeFailedBanner(events), {
      initialProps: { events: history },
    })
    rerender({
      events: [
        ...history,
        event(2, 'session.resume_failed', BACKGROUND_MESSAGE, { backgroundSessionId: '3f2a9c71' }),
      ],
    })
    expect(result.current.message).toBe(BACKGROUND_MESSAGE)

    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.message).toBe(BACKGROUND_MESSAGE)

    act(() => result.current.dismiss())
    expect(result.current.message).toBeNull()
  })

  it('still clears an ordinary resume failure after 8 seconds', () => {
    const { result, rerender } = renderHook(({ events }) => useResumeFailedBanner(events), {
      initialProps: { events: history },
    })
    rerender({
      events: [...history, event(2, 'session.resume_failed', 'the previous conversation is still resumable')],
    })
    expect(result.current.message).toBe('the previous conversation is still resumable')

    act(() => vi.advanceTimersByTime(8000))
    expect(result.current.message).toBeNull()
  })
})
