import {
  type Feature,
  IN_PLAY_WORKER_STATUSES,
  projectQuiet,
  QUIET_ALERT_MS,
  QUIET_ALERT_OPENING,
  quietAlertLine,
  type QuietFeature,
  type QuietReason,
  type QuietSnapshot,
  type SessionRow,
  stoppedFeatures,
  type WorkerKind,
  type WorkerStatus,
} from '@runcastle/core'
import { and, desc, eq, inArray, isNotNull, like, or } from 'drizzle-orm'
import { features, readyDeclarations, sessions, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { featureSessions, getSessionRow, newestThread, projectSessions } from '../launcher/sessions'
import { leadAnsweredHuman, threadBusy, threadNeed } from '../threads/read'
import { agentHost } from '../threads/types'
import { subscribeLive } from './bus'
import { getEventRow } from './events'
import { featureWorking, needOf } from './feature-need'
import { activeDriveInfo } from './git'
import { listProjects } from './projects'
import { hasActiveRun, rowToFeature } from './repo'
import { clearWait, SESSION_WAIT_CLEARED, SESSION_WAITING, setWait, waitOf } from './waits'

/**
 * Runcastle says when nothing is running (ADR-0023 decision 12): one "needs
 * you", set by runcastle on the project's orchestrator chat, when the project
 * has started features, nothing has run in it for {@link QUIET_ALERT_MS}, and
 * nothing in it waits on the human. Once per stop; cleared when work runs
 * again. No agent is woken: setting a wait wakes nobody, and the needs watcher
 * turns it into the human's ping like any other.
 */

/** How often every project is looked at, so a stop is seen even when no event comes. */
export const QUIET_TICK_MS = 60_000
/** How long a project's changes settle before it is looked at again. */
export const QUIET_SETTLE_MS = 50

/** The worker kinds that carry an assignment of their own: a quiet one has stopped short. */
const ASSIGNED_KINDS: readonly WorkerKind[] = ['on-its-own', 'review']
/**
 * A worker still at its assignment, by status; whether a turn runs is read
 * from the host. "stalled" is the status "A worker never shows working with
 * nothing running" adds: read already, so the alert words it the day it lands.
 */
const STILL_ASSIGNED: readonly string[] = ['working', 'stalled']
const IN_PLAY = [...IN_PLAY_WORKER_STATUSES, 'stalled'] as WorkerStatus[]

/** The project as the watcher reads it: the rule's snapshot, the chat the alert would go on, and what runs. */
export interface QuietRead extends QuietSnapshot {
  /** The chat the alert goes on, when any feature has stopped. */
  target: string | null
  /** All that runs is chats held for the usage limit trying again: the stop goes on (decision 6). */
  onlyLimitRetries: boolean
}

/**
 * The project as the quiet rule reads it. Running is read from what runs (the
 * agent host, runs, the worker queue, a drive), never from a stored status.
 */
export function quietSnapshot(ctx: AppCtx, projectId: string): QuietRead {
  const host = agentHost(ctx)
  const open = ctx.db
    .select()
    .from(features)
    .where(and(eq(features.projectId, projectId), eq(features.status, 'active')))
    .orderBy(features.createdAt)
    .all()
    .map(rowToFeature)
  const ids = open.map((f) => f.id)
  const epics = projectSessions(ctx, projectId, 'project')

  const workerRows = ids.length
    ? ctx.db
        .select({ id: workers.id, featureId: workers.featureId, kind: workers.kind, status: workers.status })
        .from(workers)
        .where(and(inArray(workers.featureId, ids), inArray(workers.status, IN_PLAY)))
        .all()
    : []
  // Every chat of the project the usage limit holds, with when it tries again.
  const holds = ctx.db
    .select({ id: sessions.id, featureId: sessions.featureId, at: sessions.limitWakeAt })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.limitWakeAt),
        ids.length ? or(eq(sessions.projectId, projectId), inArray(sessions.featureId, ids)) : eq(sessions.projectId, projectId),
      ),
    )
    .all()
  const held = new Set(holds.map((h) => h.id))
  /** Some of it runs, and every turn that does belongs to a chat held for the limit. */
  const onlyHeld = (rows: readonly SessionRow[]) => {
    const busy = rows.filter((row) => threadBusy(ctx, row.id))
    return busy.length > 0 && busy.every((row) => held.has(row.id))
  }

  let featuresRetrying = true
  const quietFeatures: QuietFeature[] = open.map((feature) => {
    const own = workerRows.filter((w) => w.featureId === feature.id)
    const queued = own.some((w) => w.status === 'queued')
    const running = queued || featureWorking(ctx, feature.id)
    if (running && (queued || hasActiveRun(ctx, feature.id) || !onlyHeld(featureSessions(ctx, feature.id, ['chat', 'worker'])))) {
      featuresRetrying = false
    }
    const midAssignment = own.filter(
      (w) => ASSIGNED_KINDS.includes(w.kind) && STILL_ASSIGNED.includes(w.status) && !host.isRunning(w.id),
    )
    const hold = Math.min(...holds.flatMap((h) => (h.featureId === feature.id && h.at !== null ? [h.at] : [])))
    const limitUntil = Number.isFinite(hold) ? hold : undefined
    const stoppedByHuman = feature.stoppedAt !== null && !((feature.lastHumanMessageAt ?? 0) > feature.stoppedAt)
    const yourMove =
      stoppedByHuman || (limitUntil === undefined && !midAssignment.length && leadAnsweredHuman(ctx, feature.id))
    return { title: feature.title, running, yourMove, reason: reasonOf(ctx, feature, limitUntil, midAssignment) }
  })

  const drive = activeDriveInfo(projectId) !== null
  const busyEpics = epics.filter((row) => threadBusy(ctx, row.id))
  const otherRunning = busyEpics.length > 0 || drive
  const needsYou = open.some((f) => needOf(ctx, f) !== null) || epics.some((row) => threadNeed(ctx, row) !== null)
  const snapshot: QuietSnapshot = { features: quietFeatures, otherRunning, needsYou }

  const stopped = stoppedFeatures(snapshot)
  const stoppedOpen = open.filter((_, i) => stopped.includes(quietFeatures[i]!))
  return {
    ...snapshot,
    target: targetOf(ctx, epics, stoppedOpen),
    onlyLimitRetries:
      !projectQuiet(snapshot) && !drive && featuresRetrying && busyEpics.every((row) => held.has(row.id)),
  }
}

/** Why the feature stopped, first match wins (decision 8). */
function reasonOf(
  ctx: AppCtx,
  feature: Feature,
  limitUntil: number | undefined,
  midAssignment: readonly { status: string }[],
): QuietReason {
  if (limitUntil !== undefined) return { kind: 'limit', until: limitUntil }
  if (midAssignment.length) {
    return midAssignment.some((w) => w.status === 'stalled') ? { kind: 'worker', stalled: true } : { kind: 'worker' }
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
function targetOf(ctx: AppCtx, epics: readonly SessionRow[], stopped: readonly Feature[]): string | null {
  const first = stopped[0]
  if (!first) return null
  const holders = new Set(stopped.flatMap((f) => (f.chatId ? [f.chatId] : [])))
  const holder = epics.find((row) => holders.has(row.id))
  if (holder) return holder.id
  if (epics[0]) return epics[0].id
  return newestThread(ctx, { featureId: first.id }, 'chat')?.id ?? null
}

/** The project a session belongs to, whichever way its row says so. */
function projectOf(ctx: AppCtx, row: { projectId?: string | null; featureId?: string | null }): string | undefined {
  if (row.projectId) return row.projectId
  if (!row.featureId) return undefined
  return ctx.db.select({ projectId: features.projectId }).from(features).where(eq(features.id, row.featureId)).get()?.projectId
}

/** The alert's wait as the watcher set it, so only that one is ever cleared. */
interface Alert {
  sessionId: string
  since: number
}

/** The alerts a server before this one left standing, by project: this watcher clears them as its own. */
function standingAlerts(ctx: AppCtx): Map<string, Alert> {
  const rows = ctx.db
    .select({ id: sessions.id, projectId: sessions.projectId, featureId: sessions.featureId, since: sessions.waitSince })
    .from(sessions)
    .where(and(eq(sessions.waitBy, 'runcastle'), like(sessions.waitWhy, `${QUIET_ALERT_OPENING}%`)))
    .all()
  const out = new Map<string, Alert>()
  for (const row of rows) {
    const projectId = projectOf(ctx, row)
    if (projectId) out.set(projectId, { sessionId: row.id, since: row.since ?? 0 })
  }
  return out
}

/** One project's stop, as the watcher remembers it. */
interface ProjectStop {
  /** When the current stop began; null while work runs. */
  quietSince: number | null
  /** This stop already raised its alert: no second one until it ends. */
  raised: boolean
  /** The wait the alert set, while it may still stand. */
  alert: Alert | null
}

export interface QuietWatchOptions {
  now?: () => number
  quietMs?: number
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
 * quiet, and an alert the last server left standing is this stop's. Called
 * once at boot.
 */
export function startQuietWatch(ctx: AppCtx, opts: QuietWatchOptions = {}): QuietWatch {
  const now = opts.now ?? Date.now
  const quietMs = opts.quietMs ?? QUIET_ALERT_MS
  const started = now()
  const standing = standingAlerts(ctx)
  const stops = new Map<string, ProjectStop>()
  const pending = new Set<string>()
  let settle: ReturnType<typeof setTimeout> | undefined

  function stopOf(projectId: string): ProjectStop {
    let stop = stops.get(projectId)
    if (!stop) {
      const alert = standing.get(projectId) ?? null
      stop = { quietSince: started, raised: alert !== null, alert }
      stops.set(projectId, stop)
    }
    return stop
  }

  /** Work runs again: clear the alert if it is still ours, and arm for the next stop. */
  function endStop(stop: ProjectStop): void {
    const alert = stop.alert
    stop.alert = null
    stop.raised = false
    stop.quietSince = null
    if (!alert) return
    const wait = waitOf(ctx, alert.sessionId)
    // Only our own wait: the agent may have replaced it, or the human answered it.
    if (wait && wait.by === 'runcastle' && wait.since === alert.since) clearWait(ctx, alert.sessionId, 'resumed')
  }

  function check(projectId: string): void {
    try {
      const at = now()
      const stop = stopOf(projectId)
      const snap = quietSnapshot(ctx, projectId)

      if (!projectQuiet(snap)) {
        // A held chat trying again is the same stop, whether or not the limit has lifted yet (decision 6).
        if (!(snap.onlyLimitRetries && stop.quietSince !== null)) endStop(stop)
        return
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
    const projectId = row ? projectOf(ctx, row) : undefined
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
