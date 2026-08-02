import { useEffect, useRef, useSyncExternalStore } from 'react'
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
 * The stream's state, kept outside React so any component can read it without
 * the root having to thread a provider through the whole tree. There is exactly
 * one stream (`useLiveSync` mounts once at the app root), so one module-level
 * value is the honest shape for it.
 */
let liveStatus: LiveStatus = 'connecting'
const statusListeners = new Set<() => void>()

function setLiveStatus(next: LiveStatus): void {
  if (next === liveStatus) return
  liveStatus = next
  for (const listener of statusListeners) listener()
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** The SSE stream's current state. */
function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribeStatus, () => liveStatus)
}

/**
 * How often a query should poll while the stream is UP — the safety net's
 * cadence, not the UI's freshness budget: push already delivers every change
 * within milliseconds.
 *
 * Not `false`. A signal the server never publishes, or a stream a proxy is
 * silently buffering, would strand the UI forever with polling switched off;
 * one slow tick bounds that at half a minute for a cost of nothing.
 */
const LIVE_SAFETY_POLL_MS = 30_000

/** The default cadence a query falls back to when the stream is down. */
const FALLBACK_POLL_MS = 1500

/**
 * The `refetchInterval` for a query whose data the SSE feed already
 * invalidates (findings F11).
 *
 * The duplicate-poll storm was structural, not a config mistake:
 * `refetchInterval` is per *observer*, and the same query is observed from
 * several places at once — `feature.list` from the shell, the rail, the status
 * bar and the project body; `feature.get` from the workspace, the inspector and
 * the phase body. Four to six observers each firing their own 1.5s timer is
 * four to six identical requests every 1.5s, staggered so they read as a
 * continuous stream of duplicates. `events.list` was worse: each `useEventLog`
 * carries its OWN accumulating `afterId`, so its consumers do not even share a
 * cache entry — five independent queries, five timers, five overlapping batches.
 *
 * Rather than restructure who owns which query, this makes the poll what its
 * own docs already say it is — the fallback for a stream that is down. While
 * push is live the timers back off to {@link LIVE_SAFETY_POLL_MS}; the instant
 * the stream drops they return to `ms`, so an offline server is still noticed
 * as fast as it ever was.
 */
export function useLivePoll(ms: number = FALLBACK_POLL_MS): number {
  return useLiveStatus() === 'live' ? LIVE_SAFETY_POLL_MS : ms
}

/**
 * Mount once, at the app root. Returns the stream's connection state so the
 * shell can show that updates are flowing (or that it fell back to polling).
 */
export function useLiveSync(): LiveStatus {
  const utils = trpc.useUtils()
  const status = useLiveStatus()

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
      // Findings carry the dry-run stamps the next-step bar warns on, and a
      // clean dry run stamps them mid-session — without this the warning would
      // outlive the run that disproved it until the next remount.
      void u.project.prep.invalidate()
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
      setLiveStatus('live')
      // Reconnect resync: while the stream was down (server restart, laptop
      // asleep, network blip) signals were missed by definition. Refetch
      // everything once so the UI is correct without a page reload.
      invalidateDbBacked()
      invalidateTranscript()
    })

    source.addEventListener('live', (ev) => {
      setLiveStatus('live')
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
      setLiveStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    })

    return () => {
      source.close()
      // Queries read the module status to decide their poll cadence, so a
      // closed stream must never leave it reading `live`.
      setLiveStatus('connecting')
    }
  }, [])

  return status
}
