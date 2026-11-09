import type { EventRow, Feature, FeatureFinish, SessionRow } from '@runcastle/core'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { events, features, projects } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { getSessionRow, projectSessions } from '../launcher/sessions'
import { hasThreadLog, readThreadEvents } from '../threads/log'
import { threadName } from '../threads/naming'
import { emit, emitProject } from './events'
import { clearHandback } from './lead-status'
import { getFeatureRow } from './repo'

/**
 * Every feature has one owner (`every-feature-has-one-owner`, on top of
 * `threads-hold-features`): the human, or one orchestrator chat. The owner is
 * `features.held_by` (null: the human); beside it a feature keeps its chat
 * (`chat_id`, the orchestrator chat it came from) and how far that chat takes it
 * (`finish`). This module is the one writer of all three: every owner change
 * goes through {@link giveToChat} or {@link releaseToHuman}, each emitting one
 * {@link OWNER_CHANGED} event and ending an outstanding handback.
 *
 * Holding binds project threads: a chat acts only on what it owns. The human's
 * buttons and the feature's own agent never read it, except that a lead under a
 * chat owner talks to that chat (no `wait_for_you`, no phone notification).
 */

/** The marker of a project's sweep: a project with this event is never swept again. */
export const HOLDERS_SWEPT = 'holders.swept'

/** The one event every owner change emits; its data is an {@link OwnerChange}. */
export const OWNER_CHANGED = 'feature.owner_changed'

/** What changed the owner, on the event and on the timeline. */
export type OwnerCause = 'control' | 'typed' | 'take' | 'create' | 'plan-agreed' | 'replacement' | 'moved'

/** The data of a {@link OWNER_CHANGED} event: the owner after it (null: the human), its chat, finish, and the owner before. */
export interface OwnerChange {
  owner: string | null
  chatId: string | null
  finish: FeatureFinish
  cause: OwnerCause
  from: string | null
}

/** A chat's finish choices; `you` is the human's. */
export type ChatFinish = Exclude<FeatureFinish, 'you'>

/** How far a chat takes the feature, in words (decision 12's long set). */
const FINISH_WORDS: Record<FeatureFinish, string> = {
  you: 'you finish it',
  show: 'shows you before merging',
  merge: 'merges it',
}

const CAUSE_WORDS: Record<OwnerCause, string> = {
  control: 'you chose it',
  typed: 'you typed in its chat',
  take: 'you asked the chat to run it',
  create: 'the chat cut it to plan itself',
  'plan-agreed': 'its plan has the yes',
  replacement: 'the chat replaced one too long to reopen',
  moved: 'the move to one owner per feature',
}

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
export function chatNameOf(ctx: AppCtx, threadId: string): string {
  const row = getSessionRow(ctx, threadId)
  return row ? holderName(row) : threadId
}

const nameOf = chatNameOf

/**
 * Write the feature's owner, its chat and finish; end its outstanding handback
 * (the hold moved, or the chat it went to is no longer its chat); emit one
 * {@link OWNER_CHANGED}. Nothing happens when nothing would change.
 */
function writeOwner(
  ctx: AppCtx,
  feature: Feature,
  next: { owner: string | null; chatId: string | null; finish: FeatureFinish },
  cause: OwnerCause,
): boolean {
  const from = feature.heldBy ?? null
  if (from === next.owner && feature.chatId === next.chatId && feature.finish === next.finish) return false
  ctx.db
    .update(features)
    .set({ heldBy: next.owner, chatId: next.chatId, finish: next.finish })
    .where(eq(features.id, feature.id))
    .run()
  clearHandback(ctx, feature.id, 'hold')
  const data: OwnerChange = { ...next, cause, from }
  const message = next.owner
    ? `owned by the orchestrator chat "${nameOf(ctx, next.owner)}", which ${FINISH_WORDS[next.finish]} (${CAUSE_WORDS[cause]})`
    : next.chatId
      ? `yours${next.finish === 'you' ? '' : `, then the chat "${nameOf(ctx, next.chatId)}" ${FINISH_WORDS[next.finish]}`} (${CAUSE_WORDS[cause]})`
      : `yours (${CAUSE_WORDS[cause]})`
  emit(ctx, feature.id, { type: OWNER_CHANGED, message, data })
  return true
}

/**
 * Give a feature to an orchestrator chat (decisions 4, 11, 14): it owns the
 * feature, becomes its chat, and takes it as far as `finish` says. Refused on a
 * shipped feature. Returns the owner it had before (null: the human).
 */
export function giveToChat(
  ctx: AppCtx,
  featureId: string,
  threadId: string,
  finish: ChatFinish,
  cause: OwnerCause,
): { from: string | null } {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status === 'shipped') {
    throw new GateError(`\`${feature.slug}\` has shipped, so there is nothing to give.`)
  }
  const from = feature.heldBy ?? null
  writeOwner(ctx, feature, { owner: threadId, chatId: threadId, finish }, cause)
  return { from }
}

/**
 * Make a feature the human's (decisions 5, 23): no holder, finish `you`, its
 * chat kept so it can be given back. The chat that let go is not woken; it
 * hears on its next turn ({@link releasedFrom}) and its tools refuse the
 * feature from then on.
 */
export function releaseToHuman(ctx: AppCtx, featureId: string, cause: Extract<OwnerCause, 'control' | 'typed'>): boolean {
  const feature = getFeatureRow(ctx, featureId)
  return writeOwner(ctx, feature, { owner: null, chatId: feature.chatId, finish: 'you' }, cause)
}

/**
 * The human typed in the lead's main chat (decision 23): a chat-owned feature
 * becomes theirs. Only that path calls this; a message runcastle or the
 * orchestrator delivers never does.
 */
export function releaseOnTyped(ctx: AppCtx, featureId: string): void {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.heldBy && feature.status !== 'shipped') releaseToHuman(ctx, featureId, 'typed')
}

/** When the human last took `featureId` from `threadId`, if its newest owner change is that; else null. */
export function lostToHumanAt(ctx: AppCtx, featureId: string, threadId: string): number | null {
  const last = ctx.db
    .select({ ts: events.ts, data: events.data })
    .from(events)
    .where(and(eq(events.featureId, featureId), eq(events.type, OWNER_CHANGED)))
    .orderBy(desc(events.id))
    .limit(1)
    .get()
  const change = last?.data as Partial<OwnerChange> | undefined
  return last && change?.owner === null && change.from === threadId ? last.ts : null
}

/**
 * What every tool that changes a feature goes through (decision 19): this
 * chat's own feature passes; another chat's is refused by name; the human's is
 * refused, saying how the human hands it over (no silent claim any more). A
 * shipped feature nobody holds passes: its acting tools refuse it themselves.
 */
export function requireHold(ctx: AppCtx, session: SessionRow, feature: Feature): Feature {
  if (feature.heldBy === session.id) return feature
  if (feature.heldBy) {
    throw new GateError(
      `\`${feature.slug}\` is held by the orchestrator chat "${nameOf(ctx, feature.heldBy)}", so nothing was done. ` +
        `It moves to this chat only when the human tells this chat "run ${feature.slug} for me" (take_feature).`,
    )
  }
  if (feature.status === 'shipped') return feature
  throw new GateError(humanOwnsLine(ctx, session, feature))
}

/** The refusal on a human-owned feature: whose it is, since when if this chat lost it, and how it comes back. */
function humanOwnsLine(ctx: AppCtx, session: SessionRow, feature: Feature): string {
  const lost = lostToHumanAt(ctx, feature.id, session.id)
  const owns = lost
    ? `the human took \`${feature.slug}\` on ${new Date(lost).toISOString().slice(0, 16).replace('T', ' ')}, so it is theirs`
    : `the human owns \`${feature.slug}\``
  return (
    `${owns} and nothing was done. You may still send_to_feature and read it. ` +
    `They hand it to a chat by telling it "run ${feature.slug} for me" (take_feature), or with its owner control.`
  )
}

/**
 * What `send_to_feature` goes through: allowed on this chat's own feature and
 * on a human-owned one (a marked note, or an answer to its lead's question,
 * decisions 6, 9); refused on another chat's.
 */
export function requireMayMessage(ctx: AppCtx, session: SessionRow, feature: Feature): Feature {
  if (feature.heldBy && feature.heldBy !== session.id) return requireHold(ctx, session, feature)
  return feature
}

/**
 * `take_feature`: on the human's words ("run X for me"), the calling chat owns
 * the feature, becomes its chat, and takes it as far as `finish` says.
 */
export function takeFeature(ctx: AppCtx, session: SessionRow, feature: Feature, finish: ChatFinish = 'show'): { from: string | null } {
  if (feature.status === 'shipped') {
    throw new GateError(`\`${feature.slug}\` has shipped, so there is nothing to take.`)
  }
  return giveToChat(ctx, feature.id, session.id, finish, 'take')
}

/**
 * The owner control and the row menu (decisions 11, 21): `you` makes it the
 * human's; a chat's choice gives it to its chat, refused when it has none.
 */
export function setOwner(ctx: AppCtx, featureId: string, choice: FeatureFinish): Feature {
  const feature = getFeatureRow(ctx, featureId)
  if (choice === 'you') {
    releaseToHuman(ctx, featureId, 'control')
  } else {
    if (!feature.chatId) {
      throw new InvalidInputError(
        `\`${feature.slug}\` has no orchestrator chat to give it to: ask one "run ${feature.slug} for me".`,
      )
    }
    giveToChat(ctx, featureId, feature.chatId, choice, 'control')
  }
  return getFeatureRow(ctx, featureId)
}

/**
 * The lead's plan yes on a human-owned feature whose finish is a chat's
 * (decision 14): it passes to its chat before the handback is delivered.
 * True when it passed.
 */
export function passAtPlanYes(ctx: AppCtx, feature: Feature): boolean {
  if (feature.heldBy || !feature.chatId || feature.finish === 'you' || feature.status === 'shipped') return false
  giveToChat(ctx, feature.id, feature.chatId, feature.finish, 'plan-agreed')
  return true
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
 * The features the human took from this chat and still owns, with when: what
 * the chat is told on its next turn (decision 23). The caller says each once.
 */
export function releasedFrom(ctx: AppCtx, threadId: string): { featureId: string; slug: string; title: string; at: number }[] {
  const rows = ctx.db
    .select({ id: features.id, slug: features.slug, title: features.title })
    .from(features)
    .where(and(isNull(features.heldBy), eq(features.chatId, threadId), ne(features.status, 'shipped')))
    .all()
  return rows.flatMap((row) => {
    const at = lostToHumanAt(ctx, row.id, threadId)
    return at === null ? [] : [{ featureId: row.id, slug: row.slug, title: row.title, at }]
  })
}

/**
 * Hand everything one thread owns, and every feature whose chat it is, to the
 * thread replacing it, when reopening a chat past the re-entry cap opens a new
 * thread instead (decision 10; one-owner decision 21).
 */
export function inheritHolds(ctx: AppCtx, fromId: string, toId: string): void {
  const rows = ctx.db
    .select()
    .from(features)
    .where(and(or(eq(features.heldBy, fromId), eq(features.chatId, fromId)), ne(features.status, 'shipped')))
    .all()
  for (const row of rows) {
    const feature = getFeatureRow(ctx, row.id)
    writeOwner(
      ctx,
      feature,
      {
        owner: feature.heldBy === fromId ? toId : (feature.heldBy ?? null),
        chatId: feature.chatId === fromId || feature.heldBy === fromId ? toId : feature.chatId,
        finish: feature.finish,
      },
      'replacement',
    )
  }
}

// --- Moving today's features (decision 24) ----------------------------------

/** The marker of a project's owner move: a project with this event is never moved again. */
export const OWNERS_MOVED = 'owners.moved'

/** One feature as the move reads it. */
export type OwnerMoveFeature = Pick<Feature, 'id' | 'slug' | 'title' | 'status' | 'heldBy' | 'chatId' | 'finish'>

/** One feature's owner, chat and finish after the move, and why. */
export interface OwnerMove {
  featureId: string
  slug: string
  title: string
  /** The owning chat's thread id; null: the human. */
  owner: string | null
  chatId: string | null
  finish: FeatureFinish
  reason: string
}

/**
 * Decide the move (decision 24 as changed): a held feature keeps its chat as
 * owner and as its chat, finish `show`; an unheld one stays the human's with
 * finish `you`, and gets its chat from its creation record where that names one
 * (`createdBy` on `feature.created`, else the first `feature.held` after it).
 * Pure: `events` are the features' events in any order. A shipped feature, or
 * one already under the new rules (it has a chat), is left out, so running it on
 * data written under the new rules moves nothing.
 */
export function planOwnerMove(
  list: readonly OwnerMoveFeature[],
  featureEvents: readonly Pick<EventRow, 'id' | 'featureId' | 'type' | 'data'>[],
): OwnerMove[] {
  const byFeature = new Map<string, Pick<EventRow, 'id' | 'type' | 'data'>[]>()
  for (const e of [...featureEvents].sort((a, b) => a.id - b.id)) {
    if (!e.featureId) continue
    byFeature.set(e.featureId, [...(byFeature.get(e.featureId) ?? []), e])
  }
  const moves: OwnerMove[] = []
  for (const f of list) {
    if (f.status === 'shipped' || f.chatId) continue
    const base = { featureId: f.id, slug: f.slug, title: f.title }
    if (f.heldBy) {
      moves.push({ ...base, owner: f.heldBy, chatId: f.heldBy, finish: 'show', reason: 'held by a chat: it stays the owner and becomes its chat; it shows you before merging' })
      continue
    }
    const chat = creatingChat(byFeature.get(f.id) ?? [])
    if (chat) {
      moves.push({ ...base, owner: null, chatId: chat.threadId, finish: 'you', reason: `yours; its chat comes from its creation record (${chat.from})` })
    }
  }
  return moves
}

/** The chat a feature's creation record names, if any. */
function creatingChat(list: readonly Pick<EventRow, 'type' | 'data'>[]): { threadId: string; from: string } | null {
  const created = list.findIndex((e) => e.type === 'feature.created')
  const createdBy = stringField(list[created]?.data, 'createdBy')
  if (createdBy) return { threadId: createdBy, from: 'createdBy' }
  const held = list.slice(Math.max(created, 0)).find((e) => e.type === 'feature.held')
  const threadId = stringField(held?.data, 'threadId')
  return threadId ? { threadId, from: 'first hold' } : null
}

function stringField(data: unknown, key: string): string | null {
  if (!data || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Move one project, recording the result on its marker. */
function moveProject(ctx: AppCtx, projectId: string): void {
  const list = ctx.db.select().from(features).where(eq(features.projectId, projectId)).all()
  const ids = list.map((f) => f.id)
  const featureEvents =
    ids.length === 0
      ? []
      : ctx.db
          .select({ id: events.id, featureId: events.featureId, type: events.type, data: events.data })
          .from(events)
          .where(and(inArray(events.featureId, ids), inArray(events.type, ['feature.created', 'feature.held'])))
          .orderBy(asc(events.id))
          .all()
          .map((e) => ({ ...e, featureId: e.featureId ?? undefined }))
  const moves = planOwnerMove(
    list.map((f) => ({ ...f, heldBy: f.heldBy ?? undefined })),
    featureEvents,
  )
  for (const move of moves) {
    writeOwner(ctx, getFeatureRow(ctx, move.featureId), move, 'moved')
  }
  emitProject(ctx, projectId, {
    type: OWNERS_MOVED,
    message: `moved ${moves.length} feature(s) to one owner each`,
    data: { moves },
  })
}

/** Whether this install has moved to one owner per feature: the time-matching sweep is over then. */
function ownersMoved(ctx: AppCtx): boolean {
  return ctx.db.select({ id: events.id }).from(events).where(eq(events.type, OWNERS_MOVED)).limit(1).all().length > 0
}

/**
 * Move today's features to one owner each, once per project (decision 24).
 * Call after {@link sweepHolders}. Never throws: with no marker written the next
 * boot tries again, and a feature already moved is left out by
 * {@link planOwnerMove}.
 */
export function moveOwners(ctx: AppCtx): void {
  try {
    for (const { id } of ctx.db.select({ id: projects.id }).from(projects).all()) {
      const moved = ctx.db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.projectId, id), eq(events.type, OWNERS_MOVED)))
        .limit(1)
        .all()
      if (moved.length === 0) moveProject(ctx, id)
    }
  } catch (err) {
    console.error('moving features to one owner failed', err)
  }
}

// --- The first-boot holder sweep (threads-hold-features decision 7) ----------

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
      ctx.db.update(features).set({ heldBy: threadId }).where(eq(features.id, id)).run()
      emit(ctx, id, {
        type: 'feature.held',
        message: `held by the orchestrator chat "${nameOf(ctx, threadId)}", the one that last acted on it`,
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
 * running it. Call before the notifier starts. Never throws: a sweep that fails
 * must not stop the server, and with no marker written the next boot tries again.
 */
export function sweepHolders(ctx: AppCtx): void {
  try {
    // Once features have one owner each, an unheld feature is the human's on purpose: nothing is placed.
    if (ownersMoved(ctx)) return
    for (const { id } of ctx.db.select({ id: projects.id }).from(projects).all()) {
      const swept = ctx.db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.projectId, id), eq(events.type, HOLDERS_SWEPT)))
        .limit(1)
        .all()
      if (swept.length === 0) sweepProject(ctx, id)
    }
  } catch (err) {
    console.error('sweeping holders failed', err)
  }
}
