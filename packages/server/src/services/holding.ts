import type { Feature, SessionRow } from '@runcastle/core'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { events, features, projects } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { getSessionRow, projectSessions } from '../launcher/sessions'
import { hasThreadLog, readThreadEvents } from '../threads/log'
import { threadName } from '../threads/naming'
import { emit, emitProject } from './events'

/**
 * Threads hold features (`threads-hold-features`): one orchestrator thread holds
 * a feature, hears its news, and is the only thread that may act on it. This is
 * the one writer of `features.held_by`. Holding binds project threads and nothing
 * else: the human's buttons and the feature's own agent never read it.
 */

/** The marker of a project's sweep: a project with this event is never swept again. */
export const HOLDERS_SWEPT = 'holders.swept'

/** How far before an event a thread's tool call can be the call that caused it. */
const SWEEP_WINDOW_BEFORE_MS = 120_000

/** How far after: a call can reach the thread's log just after the server handled it. */
const SWEEP_WINDOW_AFTER_MS = 3_000

/** The tools whose calls can be behind an orchestrator-stamped event, as the log titles them. */
const ACTING_CALL =
  /^mcp__runcastle__(create_feature|send_to_feature|plan_feature|start_feature|stop_feature_run|drive|merge_feature|add_to_brief|take_feature|set_feature_dependencies)$/

/** The name the thread list shows for a thread. */
export function holderName(row: SessionRow): string {
  return threadName(row, hasThreadLog(row.id) ? readThreadEvents(row.id) : [])
}

/** The thread holding a feature, or null when none does. */
export function holderOf(ctx: AppCtx, feature: Pick<Feature, 'heldBy'>): SessionRow | null {
  return feature.heldBy ? getSessionRow(ctx, feature.heldBy) : null
}

/** The name of the thread with this id, for a refusal or a line. */
function nameOf(ctx: AppCtx, threadId: string): string {
  const row = getSessionRow(ctx, threadId)
  return row ? holderName(row) : threadId
}

function setHolder(ctx: AppCtx, featureId: string, threadId: string): void {
  ctx.db.update(features).set({ heldBy: threadId }).where(eq(features.id, featureId)).run()
}

/** Make `threadId` the holder of a feature nobody holds, and say so on its timeline. */
export function claimHold(ctx: AppCtx, featureId: string, threadId: string): void {
  setHolder(ctx, featureId, threadId)
  emit(ctx, featureId, {
    type: 'feature.held',
    message: `held by the thread "${nameOf(ctx, threadId)}"`,
    data: { threadId },
  })
}

/**
 * What every tool that changes a feature goes through (decision 2): a feature
 * nobody holds becomes this thread's, this thread's own passes, and another
 * thread's is refused by name. A shipped feature is left unclaimed: its acting
 * tools refuse it themselves, and nothing can happen on it to hear about.
 */
export function requireHold(ctx: AppCtx, session: SessionRow, feature: Feature): Feature {
  if (feature.heldBy === session.id) return feature
  if (feature.heldBy) {
    throw new GateError(
      `\`${feature.slug}\` is held by the thread "${nameOf(ctx, feature.heldBy)}", so nothing was done. ` +
        'take_feature moves it to this thread: use it only when the human asked you to act on this feature here.',
    )
  }
  if (feature.status === 'shipped') return feature
  claimHold(ctx, feature.id, session.id)
  return { ...feature, heldBy: session.id }
}

/**
 * Make `session` the holder, whoever held the feature (decision 3). The thread
 * that lost it hears so from `feature.taken`. Refused only on a shipped feature;
 * when two takes race, the later one wins.
 */
export function takeHold(ctx: AppCtx, session: SessionRow, feature: Feature): { from: string | null } {
  if (feature.status === 'shipped') {
    throw new GateError(`\`${feature.slug}\` has shipped, so there is nothing to take.`)
  }
  if (feature.heldBy === session.id) return { from: null }
  if (!feature.heldBy) {
    claimHold(ctx, feature.id, session.id)
    return { from: null }
  }
  const from = feature.heldBy
  const name = holderName(session)
  setHolder(ctx, feature.id, session.id)
  emit(ctx, feature.id, {
    type: 'feature.taken',
    message: `taken by the thread "${name}" from "${nameOf(ctx, from)}"`,
    data: { threadId: session.id, from, name },
  })
  return { from: nameOf(ctx, from) }
}

/** The slugs a thread holds, among features not yet shipped. */
export function heldSlugs(ctx: AppCtx, threadId: string): string[] {
  return ctx.db
    .select({ slug: features.slug })
    .from(features)
    .where(and(eq(features.heldBy, threadId), ne(features.status, 'shipped')))
    .all()
    .map((row) => row.slug)
}

/**
 * Hand everything one thread holds to the thread replacing it, when reopening a
 * chat past the re-entry cap opens a new thread instead (decision 10). No news
 * line: the replaced thread is not going to work on them again.
 */
export function inheritHolds(ctx: AppCtx, fromId: string, toId: string): void {
  const held = ctx.db
    .select({ id: features.id })
    .from(features)
    .where(and(eq(features.heldBy, fromId), ne(features.status, 'shipped')))
    .all()
  for (const { id } of held) {
    setHolder(ctx, id, toId)
    emit(ctx, id, {
      type: 'feature.held',
      message: `held by the thread "${nameOf(ctx, toId)}", which replaced a chat too long to reopen`,
      data: { threadId: toId, inheritedFrom: fromId },
    })
  }
}

type LoggedCall = { threadId: string; at: number }

/** Every acting runcastle tool call in a project's threads, as their logs record it. */
function actingCalls(ctx: AppCtx, projectId: string): LoggedCall[] {
  const calls: LoggedCall[] = []
  for (const row of projectSessions(ctx, projectId, 'project')) {
    for (const event of readThreadEvents(row.id)) {
      if (event.type === 'tool' && event.call.title && ACTING_CALL.test(event.call.title)) {
        calls.push({ threadId: row.id, at: event.at })
      }
    }
  }
  return calls
}

/** The thread whose logged call sits nearest `ts`, inside the window; null when none does. */
function threadNearest(calls: readonly LoggedCall[], ts: number): string | null {
  let best: { threadId: string; gap: number } | null = null
  for (const { threadId, at } of calls) {
    if (at < ts - SWEEP_WINDOW_BEFORE_MS || at > ts + SWEEP_WINDOW_AFTER_MS) continue
    const gap = Math.abs(at - ts)
    if (!best || gap < best.gap) best = { threadId, gap }
  }
  return best?.threadId ?? null
}

/** Sweep one project: place what the logs can place, and leave the rest unheld, saying so. */
function sweepProject(ctx: AppCtx, projectId: string): void {
  // Newest first per feature: its newest stamped event can be a side effect of
  // earlier work, such as a docs checkpoint, with no tool call near it.
  const stamped = new Map<string, number[]>()
  const stampedRows = ctx.db
    .select({ featureId: events.featureId, ts: events.ts })
    .from(events)
    .where(and(eq(events.projectId, projectId), sql`json_extract(${events.data}, '$.actor') = 'orchestrator'`))
    .orderBy(desc(events.ts))
    .all()
  for (const { featureId, ts } of stampedRows) {
    if (featureId) stamped.set(featureId, [...(stamped.get(featureId) ?? []), ts])
  }
  const candidates = ctx.db
    .select({ id: features.id })
    .from(features)
    .where(and(eq(features.projectId, projectId), isNull(features.heldBy), ne(features.status, 'shipped')))
    .all()
    .flatMap(({ id }) => {
      const times = stamped.get(id)
      return times ? [{ id, times }] : []
    })

  const calls = candidates.length > 0 ? actingCalls(ctx, projectId) : []
  let placed = 0
  for (const { id, times } of candidates) {
    const threadId = times.map((ts) => threadNearest(calls, ts)).find((match) => match !== null)
    if (threadId) {
      setHolder(ctx, id, threadId)
      emit(ctx, id, {
        type: 'feature.held',
        message: `held by the thread "${nameOf(ctx, threadId)}", the one that last acted on it`,
        data: { threadId, swept: true },
      })
      placed += 1
    } else {
      emit(ctx, id, {
        type: 'feature.hold_unplaced',
        message: 'no thread could be matched to this feature, so none holds it until one acts on it or takes it',
      })
    }
  }
  emitProject(ctx, projectId, {
    type: HOLDERS_SWEPT,
    message: `gave ${placed} feature(s) in flight their holder; ${candidates.length - placed} left unheld`,
    data: { placed, unplaced: candidates.length - placed },
  })
}

/**
 * Give the features in flight when holding shipped their real holder (decision
 * 7). Runs once per project, so a later boot cannot place a feature left unheld
 * on purpose. Log arguments are not recorded, so the match is by time. There is
 * no fallback to the newest thread: that could take a feature from the thread
 * running it. Call before the notifier starts.
 */
export function sweepHolders(ctx: AppCtx): void {
  for (const { id } of ctx.db.select({ id: projects.id }).from(projects).all()) {
    const swept = ctx.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.projectId, id), eq(events.type, HOLDERS_SWEPT)))
      .limit(1)
      .all()
    if (swept.length === 0) sweepProject(ctx, id)
  }
}
