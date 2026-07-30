import { useEffect, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { trpc } from '../trpc'
import { useLivePoll } from './live'

/**
 * Append-only event log for a feature (SPEC §10). Polls `events.list` at 1.5s
 * using the last-seen event id as the `afterId` cursor and accumulates new
 * rows. Mount this under a component keyed by featureId so the log resets on
 * navigation.
 */
export function useEventLog(featureId: string): EventRow[] {
  const [events, setEvents] = useState<EventRow[]>([])

  const afterId = events.length ? events[events.length - 1].id : undefined
  const query = trpc.events.list.useQuery(
    { featureId, afterId },
    // Each consumer accumulates its own cursor, so each has its OWN query key —
    // five mounted logs are five independent polls, not one shared fetch
    // (findings F11). The SSE feed already invalidates all of them on every new
    // event, so the timer is only the fallback for a dead stream.
    { refetchInterval: useLivePoll() },
  )

  useEffect(() => {
    const batch = query.data
    if (!batch || batch.length === 0) return
    setEvents((prev) => {
      const known = new Set(prev.map((e) => e.id))
      const fresh = batch.filter((e) => !known.has(e.id))
      if (fresh.length === 0) return prev
      return [...prev, ...fresh].sort((a, b) => a.id - b.id)
    })
  }, [query.data])

  return events
}
