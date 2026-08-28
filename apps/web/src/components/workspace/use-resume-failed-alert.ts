import { useEffect, useRef, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { useEventLog } from '../../lib/events'

/**
 * Surface `session.resume_failed` events prominently (a Resume attempt died
 * before going live — previously just a silent flicker-and-relabel). Watches
 * the feature's event log and raises a banner for ~8s on each NEW failure;
 * history replayed on mount is skipped so stale failures don't re-alert. The
 * event also stays in the inspector's activity feed permanently.
 */
export function useResumeFailedAlert(
  featureId: string,
): { message: string | null; dismiss: () => void } {
  const events = useEventLog(featureId)
  const [message, setMessage] = useState<string | null>(null)
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
    if (last) setMessage(last.message || 'session resume failed — relaunch to continue')
  }, [events])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 8000)
    return () => clearTimeout(t)
  }, [message])

  return { message, dismiss: () => setMessage(null) }
}
