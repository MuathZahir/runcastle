import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'

/**
 * Live sync: subscribes to the server's `GET /api/stream` SSE feed and
 * invalidates the affected tRPC queries the moment something changes.
 *
 * Why this exists. The UI used to be poll-only, and TanStack Query skips a
 * `refetchInterval` tick whenever the document is hidden. Browsers *also*
 * throttle background-tab timers down to about once a minute, and the interval
 * is never rescheduled when you come back — so returning to a backgrounded tab
 * left the UI frozen for up to a minute, which is the "I have to refresh"
 * symptom. Push removes the dependence on timers entirely: a hidden tab still
 * receives SSE messages, so it stays current while you are away.
 *
 * Signals say only *what* changed; the data always comes back through the
 * normal queries, so there is one source of truth. Polling stays configured as
 * the fallback for a stream that is down, and `refetchOnWindowFocus` covers the
 * gap on return.
 */

/** Mirrors `LiveSignal` in packages/server/src/services/bus.ts. */
type LiveSignal =
  | { kind: 'event'; projectId: string; featureId?: string; eventId: number }
  | { kind: 'transcript'; ticketId: string }

export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Mount once, at the app root. Returns the stream's connection state so the
 * shell can show that updates are flowing (or that it fell back to polling).
 */
export function useLiveSync(): LiveStatus {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState<LiveStatus>('connecting')

  // `utils` is a new proxy object each render; the effect must run exactly once
  // (a re-subscribe cycle would drop signals), so reach it through a ref.
  const utilsRef = useRef(utils)
  utilsRef.current = utils

  useEffect(() => {
    /**
     * Everything whose data is derived from the events table or the run state.
     * Deliberately an allowlist: `setup.doctor` shells out to probe the
     * machine, so a blanket invalidate would re-run real work on every signal.
     */
    const invalidateDbBacked = (): void => {
      const u = utilsRef.current
      void u.events.invalidate()
      void u.feature.list.invalidate()
      void u.feature.get.invalidate()
      void u.feature.driveInfo.invalidate()
      void u.run.get.invalidate()
      void u.project.list.invalidate()
      // Spec/plan documents: these queries have no polling interval at all, so
      // before push they only ever refreshed on remount — this is what made an
      // agent-written spec invisible until a page reload.
      void u.docs.read.invalidate()
    }

    const invalidateTranscript = (): void => {
      void utilsRef.current.run.agentTranscript.invalidate()
    }

    const source = new EventSource('/api/stream')

    source.addEventListener('ready', () => {
      setStatus('live')
      // Reconnect resync: while the stream was down (server restart, laptop
      // asleep, network blip) signals were missed by definition. Refetch
      // everything once so the UI is correct without a page reload.
      invalidateDbBacked()
      invalidateTranscript()
    })

    source.addEventListener('live', (ev) => {
      setStatus('live')
      let signal: LiveSignal
      try {
        signal = JSON.parse((ev as MessageEvent<string>).data) as LiveSignal
      } catch {
        // Malformed frame: fall back to refreshing everything rather than
        // silently going stale.
        invalidateDbBacked()
        return
      }
      if (signal.kind === 'transcript') invalidateTranscript()
      else invalidateDbBacked()
    })

    // `EventSource` reconnects on its own; this only reflects the gap in the
    // UI. The queries' `refetchInterval` keeps the app working meanwhile.
    source.addEventListener('error', () => {
      setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    })

    return () => {
      source.close()
    }
  }, [])

  return status
}
