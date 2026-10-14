import { useEffect, useRef, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { useEventLog } from '../../lib/events'

/** How long an ordinary resume failure stays on screen before clearing itself. */
const AUTO_DISMISS_MS = 8000

interface ResumeFailedAlert {
  message: string
  /** Stays up until dismissed — the message is instructions to copy, not a notice. */
  sticky: boolean
}

/**
 * Surface `session.resume_failed` events prominently (a Resume attempt died
 * before going live — previously just a silent flicker-and-relabel). Watches
 * the feature's event log and raises a banner on each NEW failure; history
 * replayed on mount is skipped so stale failures don't re-alert. The event also
 * stays in the inspector's activity feed permanently.
 */
export function useResumeFailedAlert(
  featureId: string,
): { message: string | null; dismiss: () => void } {
  return useResumeFailedBanner(useEventLog(featureId))
}

/**
 * The banner over a given event log. An ordinary failure clears itself after
 * {@link AUTO_DISMISS_MS}; one held by a Claude Code background session
 * (`data.backgroundSessionId`) names the `claude attach` / `claude stop`
 * commands the human must type, so it stays up until dismissed.
 */
export function useResumeFailedBanner(
  events: EventRow[],
): { message: string | null; dismiss: () => void } {
  const [alert, setAlert] = useState<ResumeFailedAlert | null>(null)
  // null until the first batch lands — everything in that batch is history.
  const lastSeenRef = useRef<number | null>(null)

  useEffect(() => {
    if (events.length === 0) return
    const maxId = events[events.length - 1].id
    if (lastSeenRef.current === null) {
      lastSeenRef.current = maxId
      return
    }
    const cutoff = lastSeenRef.current
    lastSeenRef.current = maxId
    const failed = events.filter(
      (e: EventRow) => e.id > cutoff && e.type === 'session.resume_failed',
    )
    const last = failed[failed.length - 1]
    if (last) {
      setAlert({
        message: last.message || 'session resume failed — relaunch to continue',
        sticky: heldByBackgroundSession(last),
      })
    }
  }, [events])

  useEffect(() => {
    if (!alert || alert.sticky) return
    const t = setTimeout(() => setAlert(null), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [alert])

  return { message: alert?.message ?? null, dismiss: () => setAlert(null) }
}

function heldByBackgroundSession(event: EventRow): boolean {
  const data = event.data
  return typeof data === 'object' && data !== null && 'backgroundSessionId' in data
}
