import {
  type Feature,
  IN_PLAY_WORKER_STATUSES,
  projectQuiet,
  QUIET_ALERT_MS,
  quietAlertLine,
  type QuietFeature,
  type QuietReason,
  type QuietSnapshot,
  stoppedFeatures,
  type WorkerKind,
  type WorkerStatus,
} from '@runcastle/core'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features, readyDeclarations, sessions, workers } from '../db/schema'
import { getSessionRow, newestThread, projectSessions } from '../launcher/sessions'
import { leadAnsweredHuman, threadBusy, threadNeed } from '../threads/read'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { featureWorking, needOf } from './feature-need'
import { getEventRow } from './events'
import { activeDriveInfo } from './git'
import { listProjects } from './projects'
import { rowToFeature } from './repo'
import { clearWait, SESSION_WAIT_CLEARED, SESSION_WAITING, setWait, waitOf } from './waits'

/**
 * Runcastle says when nothing is running (ADR-0023 decision 12): one "needs
 * you", set by runcastle on the project's orchestrator chat, when the project
 * has started features, nothing has run in it for {@link QUIET_ALERT_MS}, and
 * nothing in it waits on the human. Once per stop; cleared when work runs
 * again. No agent is woken: setting a wait wakes nobody, and the needs watcher
 * turns it into the human's ping like any other.
 */

/** How long work must run for a stop to be over, when the run ends with a chat held for the usage limit (decision 6). */
export const RESUME_MS = 2 * 60_000
/** How often every project is looked at, so a stop is seen even when no event comes. */
export const QUIET_TICK_MS = 60_000
/** How long a project's changes settle before it is looked at again. */
export const QUIET_SETTLE_MS = 50

/** The worker kinds that carry an assignment of their own: a quiet one has stopped short. */
const ASSIGNED_KINDS: readonly WorkerKind[] = ['on-its-own', 'review']
/** A worker still at its assignment: by status only, whether a turn runs is read from the host. */
const AT_WORK: readonly string[] = ['working', 'stalled']

/** A worker row's status, which may be one this build does not know yet ("stalled", once it lands). */
const statusOf = (status: WorkerStatus | string): string => status

/**
 * The project as the quiet rule reads it, plus the chat the alert would go on.
 * Running is read from what runs (the agent host, runs, the worker queue, a
 * drive), never from a stored status.
 */
export function quietSnapshot(ctx: AppCtx, projectId: string): QuietSnapshot & { target: string | null; limitHeld: boolean } {
  const host = agentHost(ctx)
  const open = ctx.db
    .select()
    .from(features)
    .where(and(eq(features.projectId, projectId), eq(features.status, 'active')))
    .orderBy(features.createdAt)
    .all()
    .map(rowToFeature)
  const ids = open.map((f) => f.id)

  const workerRows = ids.length
    ? ctx.db
        .select({ id: workers.id, featureId: workers.featureId, kind: workers.kind, status: workers.status })
        .from(workers)
        .where(and(inArray(workers.featureId, ids), inArray(workers.status, [...IN_PLAY_WORKER_STATUSES, 'stalled' as WorkerStatus])))
        .all()
    : []
  const holds = ids.length
    ? ctx.db
        .select({ featureId: sessions.featureId, at: sessions.limitWakeAt })
        .from(sessions)
        .where(and(inArray(sessions.featureId, ids), isNotNull(sessions.limitWakeAt)))
        .all()
    : []
  const epics = projectSessions(ctx, projectId, 'project')
  const epicHold =
    ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.limitWakeAt)))
      .get() !== undefined

  const quietFeatures: (QuietFeature & { feature: Feature })[] = open.map((feature) => {
    const own = workerRows.filter((w) => w.featureId === feature.id)
    const queued = own.some((w) => w.status === 'queued')
    const running = queued || featureWorking(ctx, feature.id)
    const midAssignment = own.filter(
      (w) => ASSIGNED_KINDS.includes(w.kind) && AT_WORK.includes(statusOf(w.status)) && !host.isRunning(w.id),
    )
    const hold = holds
      .filter((h) => h.featureId === feature.id && h.at !== null)
      .map((h) => h.at as number)
      .sort((a, b) => a - b)[0]
    const stoppedByHuman = feature.stoppedAt !== null && !((feature.lastHumanMessageAt ?? 0) > feature.stoppedAt)
    const yourMove =
      stoppedByHuman || (hold === undefined && !midAssignment.length && leadAnsweredHuman(ctx, feature.id))
    return { feature, title: feature.title, running, yourMove, reason: reasonOf(ctx, feature, hold, midAssignment) }
  })

  const otherRunning = epics.some((row) => threadBusy(ctx, row.id)) || activeDriveInfo(projectId) !== null
  const needsYou =
    open.some((f) => needOf(ctx, f) !== null) || epics.some((row) => threadNeed(ctx, row) !== null)
  const snapshot: QuietSnapshot = { features: quietFeatures, otherRunning, needsYou }

  return {
    ...snapshot,
    target: targetOf(ctx, projectId, stoppedFeatures(snapshot) as typeof quietFeatures),
    limitHeld: epicHold || holds.length > 0,
  }
}

/** Why the feature stopped, first match wins (decision 8). */
function reasonOf(
  ctx: AppCtx,
  feature: Feature,
  hold: number | undefined,
  midAssignment: { status: WorkerStatus | string }[],
): QuietReason {
  if (hold !== undefined) return { kind: 'limit', until: hold }
  if (midAssignment.length) {
    return midAssignment.some((w) => statusOf(w.status) === 'stalled') ? { kind: 'worker', stalled: true } : { kind: 'worker' }
  }
  const ready = ctx.db
    .select({ at: readyDeclarations.createdAt })
    .from(readyDeclarations)
    .where(eq(readyDeclarations.featureId, feature.id))
    .orderBy(desc(readyDeclarations.createdAt))
    .get()
  if (ready && ready.at > (feature.lastHumanMessageAt ?? 0)) return { kind: 'merge' }
  return { kind: 'unknown' }
}

/**
 * The chat the alert goes on (decision 7): the epic holding the stopped
 * features (the newest, if several), else the project's newest orchestrator
 * chat, else the first stopped feature's own chat.
 */
function targetOf(ctx: AppCtx, projectId: string, stopped: { feature: Feature }[]): string | null {
  if (!stopped.length) return null
  const epics = projectSessions(ctx, projectId, 'project')
  const holders = new Set(stopped.flatMap((s) => (s.feature.chatId ? [s.feature.chatId] : [])))
  const holder = epics.find((row) => holders.has(row.id))
  if (holder) return holder.id
  const newest = newestThread(ctx, { projectId }, 'project')
  if (newest) return newest.id
  return newestThread(ctx, { featureId: stopped[0]!.feature.id }, 'chat')?.id ?? null
}

/** One project's stop, as the watcher remembers it. */
interface Stop {
  /** When the current stop began; null while work runs and no stop stands. */
  quietSince: number | null
  /** When the work now running began; null while quiet. */
  runningSince: number | null
  /** This stop already raised its alert: no second one until it ends. */
  raised: boolean
  /** The wait the alert set, so only that one is ever cleared. */
  alert: { sessionId: string; since: number } | null
}

export interface QuietWatchOptions {
  now?: () => number
  quietMs?: number
  resumeMs?: number
  tickMs?: number
}

export interface QuietWatch {
  /** Look at one project now. */
  check(projectId: string): void
  /** Detach from the bus and stop the timer. */
  stop(): void
}

/**
 * Watch every open project for a stop: looked at on each turn change and wait
 * change of its chats, and on a timer. A server start counts as the start of
 * quiet. Called once at boot.
 */
export function startQuietWatch(ctx: AppCtx, opts: QuietWatchOptions = {}): QuietWatch {
  const now = opts.now ?? Date.now
  const quietMs = opts.quietMs ?? QUIET_ALERT_MS
  const resumeMs = opts.resumeMs ?? RESUME_MS
  const started = now()
  const stops = new Map<string, Stop>()
  const pending = new Set<string>()
  let settle: ReturnType<typeof setTimeout> | undefined

  function clearAlert(stop: Stop): void {
    const alert = stop.alert
    stop.alert = null
    if (!alert) return
    const wait = waitOf(ctx, alert.sessionId)
    // Only our own wait: the agent may have replaced it, or the human answered it.
    if (wait && wait.by === 'runcastle' && wait.since === alert.since) clearWait(ctx, alert.sessionId, 'resumed')
  }

  function check(projectId: string): void {
    try {
      const at = now()
      const stop = stops.get(projectId) ?? { quietSince: started, runningSince: null, raised: false, alert: null }
      stops.set(projectId, stop)
      const snap = quietSnapshot(ctx, projectId)

      if (!projectQuiet(snap)) {
        stop.runningSince ??= at
        // Work that has run this long ends the stop, whatever happens next.
        if (stop.quietSince !== null && at - stop.runningSince >= resumeMs) endStop(stop)
        return
      }

      if (stop.runningSince !== null) {
        const ranFor = at - stop.runningSince
        stop.runningSince = null
        // A short run that ended held by the usage limit is a retry of the same stop (decision 6).
        const retry = stop.quietSince !== null && ranFor < resumeMs && snap.limitHeld
        if (!retry) {
          endStop(stop)
          stop.quietSince = at
        }
      }
      stop.quietSince ??= at

      if (stop.raised || at - stop.quietSince < quietMs) return
      const line = quietAlertLine(snap)
      if (!line || !snap.target) return
      const need = setWait(ctx, snap.target, line, 'runcastle')
      stop.raised = true
      stop.alert = need ? { sessionId: snap.target, since: need.since } : null
    } catch (err) {
      console.error('quiet watch failed', err)
    }
  }

  function endStop(stop: Stop): void {
    clearAlert(stop)
    stop.raised = false
    stop.quietSince = null
  }

  function checkAll(): void {
    for (const project of listProjects(ctx)) check(project.id)
  }

  function flush(): void {
    settle = undefined
    const ids = [...pending]
    pending.clear()
    for (const id of ids) check(id)
  }

  function schedule(sessionId: string): void {
    const row = getSessionRow(ctx, sessionId)
    const projectId =
      row?.projectId ??
      (row?.featureId
        ? ctx.db.select({ projectId: features.projectId }).from(features).where(eq(features.id, row.featureId)).get()?.projectId
        : undefined)
    if (!projectId) return
    pending.add(projectId)
    if (settle) return
    settle = setTimeout(flush, QUIET_SETTLE_MS)
    settle.unref?.()
  }

  const unsubscribe = subscribeLive((signal) => {
    try {
      if (signal.kind === 'turn') return schedule(signal.sessionId)
      if (signal.kind !== 'event') return
      const event = getEventRow(ctx, signal.eventId)
      if (!event || (event.type !== SESSION_WAITING && event.type !== SESSION_WAIT_CLEARED)) return
      const sessionId = (event.data as { sessionId?: unknown } | null)?.sessionId
      if (typeof sessionId === 'string') schedule(sessionId)
    } catch (err) {
      console.error('quiet watch failed', err)
    }
  })
  const tick = setInterval(checkAll, opts.tickMs ?? QUIET_TICK_MS)
  tick.unref?.()

  return {
    check,
    stop() {
      unsubscribe()
      clearInterval(tick)
      if (settle) clearTimeout(settle)
      pending.clear()
      stops.clear()
    },
  }
}
