import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { trpc } from '../trpc'
import { REVIEW_ARTIFACTS_KEY } from './reviews'

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
 *
 * A stream that dies silently is worse than no stream at all: while the client
 * believes it is `live` every poll is backed off to 30s, so one unnoticed death
 * freezes every surface at once. `EventSource` cannot see a half-open socket
 * (laptop sleep, network change) — it stays `OPEN` with a peer that is gone —
 * so the client verifies the server's own heartbeat instead: any frame counts
 * as a pulse, and silence past {@link PULSE_TIMEOUT_MS} means the connection
 * has stopped being believed, is force-closed and replaced. This is the same
 * treatment `lib/terminal.ts` gives the terminal WebSocket.
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
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribeStatus, () => liveStatus)
}

/** The SSE stream's current state, outside React (tests, imperative code). */
export function getLiveStatus(): LiveStatus {
  return liveStatus
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
  return livePollMs(useLiveStatus(), ms)
}

/** The cadence {@link useLivePoll} resolves to for a given stream state. */
export function livePollMs(status: LiveStatus, ms: number = FALLBACK_POLL_MS): number {
  return status === 'live' ? LIVE_SAFETY_POLL_MS : ms
}

/**
 * How long the stream may go silent before the client stops believing it.
 *
 * Must exceed the server's idle heartbeat (`HEARTBEAT_MS` = 25s in
 * packages/server/src/routes/stream.ts) by enough margin that a slow flush is
 * not mistaken for a death — a healthy but idle stream pulses well inside this.
 */
export const PULSE_TIMEOUT_MS = 35_000

/**
 * How often the watchdog compares the clock against the last frame. Coarse on
 * purpose: one cheap repeating timer costs nothing, where rescheduling a
 * per-frame timeout would churn a timer on every signal of a busy burn.
 */
const WATCHDOG_INTERVAL_MS = 5_000

/** What the stream asks the app to refetch when it (re)proves itself. */
export interface LiveSyncHandlers {
  /** Everything the events table backs — the reconnect resync. */
  resyncAll: () => void
  /** The agent transcript only. */
  resyncTranscript: () => void
}

/**
 * Open the stream and keep it honest. Returns a disposer.
 *
 * Split out of {@link useLiveSync} because the watchdog is the part with real
 * behaviour to test: it is driven entirely by `EventSource` frames, the clock
 * and window events, none of which need React.
 */
export function startLiveSync(handlers: LiveSyncHandlers): () => void {
  let source: EventSource | null = null
  /** Detaches the current source's listeners; paired with every `close()`. */
  let releaseSource: (() => void) | null = null
  let lastFrameAt = Date.now()
  let disposed = false

  const closeSource = (): void => {
    releaseSource?.()
    releaseSource = null
    source?.close()
    source = null
  }

  const connect = (): void => {
    if (disposed) return
    closeSource()
    // Liveness is earned by a frame, never assumed from an open socket — that
    // assumption is the whole bug. Queries read the module status to pick their
    // cadence, so this also re-arms fast polling for the length of the gap.
    setLiveStatus('connecting')
    lastFrameAt = Date.now()

    const s = new EventSource('/api/stream')
    source = s

    const onReady = (): void => {
      lastFrameAt = Date.now()
      setLiveStatus('live')
      // Reconnect resync: while the stream was down (server restart, laptop
      // asleep, network blip) signals were missed by definition. Refetch
      // everything once so the UI is correct without a page reload.
      handlers.resyncAll()
      handlers.resyncTranscript()
    }

    const onLive = (ev: Event): void => {
      lastFrameAt = Date.now()
      setLiveStatus('live')
      let signal: LiveSignal
      try {
        signal = JSON.parse((ev as MessageEvent<string>).data) as LiveSignal
      } catch {
        // Malformed frame: fall back to refreshing everything rather than
        // silently going stale.
        handlers.resyncAll()
        return
      }
      if (signal.kind === 'transcript') handlers.resyncTranscript()
      else handlers.resyncAll()
    }

    // The server's idle heartbeat. It carries no news, so it invalidates
    // nothing — its whole job is to prove the pipe is still there.
    const onPing = (): void => {
      lastFrameAt = Date.now()
    }

    // `EventSource` reconnects on its own; this only reflects the gap in the
    // UI. The queries' `refetchInterval` keeps the app working meanwhile.
    const onError = (): void => {
      setLiveStatus(s.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    }

    s.addEventListener('ready', onReady)
    s.addEventListener('live', onLive)
    s.addEventListener('ping', onPing)
    s.addEventListener('error', onError)

    releaseSource = () => {
      s.removeEventListener('ready', onReady)
      s.removeEventListener('live', onLive)
      s.removeEventListener('ping', onPing)
      s.removeEventListener('error', onError)
    }
  }

  /**
   * Silence past the timeout means the socket is dead in a way `EventSource`
   * cannot report, so there is nothing to wait for: drop it and open a new one.
   * There is no forced-reconnect API — a fresh instance is the reconnect.
   */
  const checkPulse = (): void => {
    if (disposed || Date.now() - lastFrameAt <= PULSE_TIMEOUT_MS) return
    connect()
  }

  const watchdog = setInterval(checkPulse, WATCHDOG_INTERVAL_MS)

  // Background tabs get their timers throttled or suspended outright, so the
  // watchdog above cannot be relied on to have run while you were away — the
  // frozen-tab case is exactly the one it would miss. Returning to the tab, or
  // the network coming back, checks the pulse immediately instead.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') checkPulse()
  }
  window.addEventListener('focus', checkPulse)
  window.addEventListener('online', checkPulse)
  document.addEventListener('visibilitychange', onVisibilityChange)

  connect()

  return () => {
    disposed = true
    clearInterval(watchdog)
    window.removeEventListener('focus', checkPulse)
    window.removeEventListener('online', checkPulse)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    closeSource()
    // Queries read the module status to decide their poll cadence, so a
    // closed stream must never leave it reading `live`.
    setLiveStatus('connecting')
  }
}

/**
 * Mount once, at the app root. Returns the stream's connection state so the
 * shell can show that updates are flowing (or that it fell back to polling).
 */
export function useLiveSync(): LiveStatus {
  const utils = trpc.useUtils()
  // The review artifact listing is the one live surface that is not a tRPC
  // query (media wants plain HTTP), so it is invalidated through the client
  // directly rather than through `utils`. Needs no ref: the provider holds one
  // client for the app's lifetime, so this is the same object every render.
  const queryClient = useQueryClient()
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
      // Test-drive notes: the review checklist is a live surface — a note added,
      // ticked, edited or promoted has to show up at push speed, not on the 30s
      // safety poll.
      void u.notes.invalidate()
      // The review agent's findings: `finding.*` events arrive one per finding
      // AS the review reports them, and the fix wave that follows moves them
      // again — the review page's counts line and its open-defects list are only
      // honest if they move on the same push.
      void u.findings.invalidate()
      // Findings carry the dry-run stamps the next-step bar warns on, and a
      // clean dry run stamps them mid-session — without this the warning would
      // outlive the run that disproved it until the next remount.
      void u.project.prep.invalidate()
      void u.run.get.invalidate()
      // The run history behind the runs counter (decision #15b) — a burn that
      // starts adds a row to it, and the counter is on screen while that happens.
      void u.run.listByFeature.invalidate()
      void u.project.list.invalidate()
      // Spec/plan documents: these queries have no polling interval at all, so
      // before push they only ever refreshed on remount — this is what made an
      // agent-written spec invisible until a page reload.
      void u.docs.read.invalidate()
      // Settings, commit counts and the prep/project session rows: all of them
      // change under a running agent, and each one used to depend on its own
      // hardcoded interval (or on a remount) to notice.
      void u.settings.get.invalidate()
      // The project chat's landing branch is a settings write like any other, so
      // the picker that shows it has to move on the same push — it has no
      // polling interval of its own, and the settings overlay carries a row for
      // the same value.
      void u.project.sessionBranch.invalidate()
      void u.feature.commitCount.invalidate()
      // The merge confirmation's "what lands" row is the same git read one step
      // further on (commits AND files), so it moves when the count does.
      void u.feature.mergeDelta.invalidate()
      void u.project.prepSession.invalidate()
      void u.project.projectSession.invalidate()
      // The review agent's walkthrough appears mid-burn, at the tail of a run
      // the human is already watching — so the player has to arrive on the same
      // push as everything else, not on a reload.
      void queryClient.invalidateQueries({ queryKey: [REVIEW_ARTIFACTS_KEY] })
    }

    const invalidateTranscript = (): void => {
      void utilsRef.current.run.agentTranscript.invalidate()
    }

    return startLiveSync({ resyncAll: invalidateDbBacked, resyncTranscript: invalidateTranscript })
  }, [])

  return status
}
