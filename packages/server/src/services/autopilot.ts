import type { Feature, SessionRow } from '@runcastle/core'
import { and, eq, inArray } from 'drizzle-orm'
import { features, sessions } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { getSessionRow, newestThread } from '../launcher/sessions'
import { chatName, chatNameOf } from '../threads/chat-name'
import { hasThreadLog } from '../threads/log'
import { agentHost } from '../threads/types'
import { mayStartInBackground } from './database-copy'
import { emitProject } from './events'
import { deliverToLead } from './lead-delivery'
import { getFeatureRow, rowToFeature } from './repo'
import { clearWait, waitOf } from './waits'

/**
 * Epics on autopilot (`epics-on-autopilot`): one fact replaces per-feature
 * ownership, on the epic (an orchestrator chat's session row): whether
 * autopilot is on. A feature is locked exactly when its epic
 * (`features.chat_id`) is on autopilot and the feature is not shipped or
 * archived (decision 14): the whole epic locks, with no per-feature mark. This
 * module is the one writer of the switch and of a feature's move between
 * epics, and {@link mayAct} is the one check the orchestrator's acting tools go
 * through.
 *
 * Nothing here stops anything running: turning on, adding and turning off only
 * move the switch and the epic links, emit one event, and tell the leads (and,
 * when the human ended it from a lock note, the orchestrator).
 */

/** The one event every autopilot change emits, on the project's timeline; its data is an {@link AutopilotChange}. */
export const AUTOPILOT_CHANGED = 'autopilot.changed'

/** What changed. */
export type AutopilotChangeKind = 'on' | 'add' | 'off'

/** The data of an {@link AUTOPILOT_CHANGED} event. */
export interface AutopilotChange {
  epicId: string
  change: AutopilotChangeKind
  /** The features the change locked, moved into the epic, or gave back to the human. */
  featureIds: string[]
  /** Whether the epic is on autopilot after the change. */
  autopilot: boolean
  /** `human` when the lock note's "End autopilot" link ended it; else the epic's own tool call. */
  by: 'epic' | 'human'
}

/** What an orchestrator chat may want to do to a feature. */
export type AutopilotAction =
  | 'create'
  | 'start'
  | 'plan'
  | 'read'
  | 'brief'
  | 'dependencies'
  | 'message'
  | 'stop'
  | 'drive'
  | 'merge'

/** Passes on the epic's own features, autopilot or not (decision 15). */
const OWN_ACTIONS: ReadonlySet<AutopilotAction> = new Set(['create', 'start', 'plan', 'read', 'brief', 'dependencies'])

/** A locked feature, as the feature list and the lead read it: its epic and the epic's name. */
export interface FeatureAutopilot {
  epicId: string
  epicName: string
}

/** Whether the orchestrator chat `epicId` is on autopilot. */
export function epicOnAutopilot(ctx: AppCtx, epicId: string | null | undefined): boolean {
  if (!epicId) return false
  const row = ctx.db.select({ autopilot: sessions.autopilot, kind: sessions.kind }).from(sessions).where(eq(sessions.id, epicId)).get()
  return !!row && row.kind === 'project' && row.autopilot
}

/** Whether the feature is open: neither shipped nor archived. Only an open feature locks. */
function isOpen(feature: Pick<Feature, 'status'>): boolean {
  return feature.status !== 'shipped' && feature.status !== 'archived'
}

/** Whether the feature is locked: open, and its epic on autopilot (decision 14). */
export function isLocked(ctx: AppCtx, feature: Pick<Feature, 'status' | 'chatId'>): boolean {
  return isOpen(feature) && epicOnAutopilot(ctx, feature.chatId)
}

/** The feature's epic when it is locked, with the epic's name; null exactly when it is not locked. */
export function autopilotOf(ctx: AppCtx, feature: Pick<Feature, 'status' | 'chatId'>): FeatureAutopilot | null {
  if (!feature.chatId || !isLocked(ctx, feature)) return null
  return { epicId: feature.chatId, epicName: chatNameOf(ctx, feature.chatId) }
}

/**
 * {@link autopilotOf} for a whole list at once: the project's epics on
 * autopilot are read once, and each name once.
 */
export function autopilotReader(ctx: AppCtx, projectId: string): (feature: Pick<Feature, 'status' | 'chatId'>) => FeatureAutopilot | null {
  const epics = new Map<string, string>()
  const rows = ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, 'project'), eq(sessions.autopilot, true)))
    .all()
  for (const row of rows) epics.set(row.id, chatNameOf(ctx, row.id))
  return (feature) => {
    if (!feature.chatId || !isOpen(feature)) return null
    const epicName = epics.get(feature.chatId)
    return epicName === undefined ? null : { epicId: feature.chatId, epicName }
  }
}

/** The refusal of the human's message to a locked lead or one of its workers (decision 16). */
export function lockedLine(epicName: string): string {
  return `This feature is on autopilot in the epic "${epicName}", so its chats take no messages: talk to the epic, or end autopilot from the lock note.`
}

/** {@link lockedLine} as a refusal, when the feature is locked; nothing when it is not. */
export function refuseHumanMessage(ctx: AppCtx, feature: Pick<Feature, 'status' | 'chatId'>): void {
  const lock = autopilotOf(ctx, feature)
  if (lock) throw new GateError(lockedLine(lock.epicName))
}

/** The feature's link, as the orchestrator hands it to the human. */
function featureLink(feature: Pick<Feature, 'slug' | 'projectId' | 'title'>): string {
  return `[${feature.title}](/p/${encodeURIComponent(feature.projectId)}/f/${encodeURIComponent(feature.slug)}/chat)`
}

/**
 * May the orchestrator chat `chatId` do `action` on `feature`? Creating,
 * starting, planning, reading, editing a draft's brief and setting
 * dependencies pass on the epic's own features (`feature.chatId === chatId`);
 * messaging, stopping, driving and merging pass only when the feature is locked
 * to that chat (decisions 2, 15). A refusal says what to do instead.
 */
export function mayAct(
  ctx: AppCtx,
  chatId: string,
  feature: Feature,
  action: AutopilotAction,
): { ok: true } | { ok: false; reason: string } {
  const own = feature.chatId === chatId
  const locked = isLocked(ctx, feature)
  if (locked && !own) {
    return {
      ok: false,
      reason: `\`${feature.slug}\` is on autopilot in the epic "${chatNameOf(ctx, feature.chatId as string)}", so only that epic acts on it and nothing was done.`,
    }
  }
  if (OWN_ACTIONS.has(action)) {
    if (own) {
      if (action === 'brief' && feature.status !== 'draft' && !locked) {
        return {
          ok: false,
          reason: `\`${feature.slug}\` has started and is the human's, so its brief is theirs and nothing was done. Link them to its chat: ${featureLink(feature)}.`,
        }
      }
      return { ok: true }
    }
    const whose = feature.chatId ? `the epic "${chatNameOf(ctx, feature.chatId)}"` : 'no epic (the human made it with New feature)'
    return {
      ok: false,
      reason:
        `\`${feature.slug}\` is not one of this epic's features (it belongs to ${whose}), so nothing was done. ` +
        `Link the human to its chat: ${featureLink(feature)}. It joins this epic only when the human says "also run ${feature.slug}" here (set_autopilot add).`,
    }
  }
  if (locked) return { ok: true }
  return {
    ok: false,
    reason: own
      ? `\`${feature.slug}\` is the human's: autopilot is off for it, so nothing was done. Link them to its chat: ${featureLink(feature)}.`
      : `\`${feature.slug}\` is the human's and not one of this epic's features, so nothing was done. Link them to its chat: ${featureLink(feature)}.`,
  }
}

/** {@link mayAct}, throwing its refusal; the feature when it passes. */
export function requireMayAct(ctx: AppCtx, chatId: string, feature: Feature, action: AutopilotAction): Feature {
  const verdict = mayAct(ctx, chatId, feature, action)
  if (!verdict.ok) throw new GateError(verdict.reason)
  return feature
}

/** What a change did, for the tool's answer. */
export interface AutopilotResult {
  epic: string
  autopilot: boolean
  /** The epic's locked features after the change: every open one while it is on autopilot, none while it is off. */
  locked: string[]
  /** The slugs this change locked, moved into the epic, or gave back to the human. */
  changed: string[]
  /** Slugs that joined from another epic (or from none): their epic is this one now. */
  movedFrom: { slug: string; from: string | null }[]
}

function requireEpic(ctx: AppCtx, epicId: string): SessionRow {
  const row = getSessionRow(ctx, epicId)
  if (!row || row.kind !== 'project' || !row.projectId) {
    throw new GateError('only an orchestrator chat (an epic) goes on autopilot.')
  }
  return row
}

/** The features `slugs` names in the epic's project, or a refusal naming what is missing. */
function featuresBySlug(ctx: AppCtx, projectId: string, slugs: readonly string[]): Feature[] {
  const wanted = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))]
  if (wanted.length === 0) throw new InvalidInputError('name the features: the list is empty.')
  const rows = ctx.db
    .select()
    .from(features)
    .where(and(eq(features.projectId, projectId), inArray(features.slug, wanted)))
    .all()
    .map(rowToFeature)
  const missing = wanted.filter((slug) => !rows.some((f) => f.slug === slug))
  if (missing.length) throw new GateError(`there is no feature ${missing.map((s) => `\`${s}\``).join(', ')} in this project, so nothing changed.`)
  return wanted.map((slug) => rows.find((f) => f.slug === slug) as Feature)
}

/** The epic's open features (neither shipped nor archived), oldest first: the ones autopilot locks. */
function openFeaturesOf(ctx: AppCtx, epicId: string): Feature[] {
  return ctx.db
    .select()
    .from(features)
    .where(and(eq(features.chatId, epicId), inArray(features.status, ['draft', 'active'])))
    .orderBy(features.createdAt)
    .all()
    .map(rowToFeature)
}

function result(ctx: AppCtx, epic: SessionRow, changed: Feature[], movedFrom: AutopilotResult['movedFrom']): AutopilotResult {
  return {
    epic: chatName(epic),
    autopilot: epicOnAutopilot(ctx, epic.id),
    locked: epicOnAutopilot(ctx, epic.id) ? openFeaturesOf(ctx, epic.id).map((f) => f.slug) : [],
    changed: changed.map((f) => f.slug),
    movedFrom,
  }
}

function emitChange(ctx: AppCtx, epic: SessionRow, data: AutopilotChange, message: string): void {
  emitProject(ctx, epic.projectId as string, { type: AUTOPILOT_CHANGED, message, data })
}

/**
 * Close what the features' chats (lead and workers) wait on the human for, now
 * that they are locked and the human cannot answer there (decision 24). Returns
 * each feature's closed lines, by feature id.
 */
function closeWaits(ctx: AppCtx, list: readonly Feature[]): Map<string, string[]> {
  const closed = new Map<string, string[]>()
  for (const f of list) {
    const whys: string[] = []
    for (const s of featureChats(ctx, f.id)) {
      const wait = waitOf(ctx, s.id)
      if (!wait) continue
      whys.push(wait.why)
      clearWait(ctx, s.id, 'autopilot')
    }
    if (whys.length) closed.set(f.id, whys)
  }
  return closed
}

/** The feature's lead chat and worker chats. */
function featureChats(ctx: AppCtx, featureId: string): { id: string }[] {
  return ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.featureId, featureId), inArray(sessions.kind, ['chat', 'worker'])))
    .all()
}

/** Whether the feature's lead has a conversation to tell: a draft or a never-opened chat has none. */
function leadToTell(ctx: AppCtx, feature: Feature): boolean {
  const lead = newestThread(ctx, { featureId: feature.id }, 'chat')
  return !!lead && (!!lead.ccSessionId || hasThreadLog(lead.id))
}

/** Tell each newly locked lead it reports to the epic now, and to re-ask what it waited on through the epic (decision 24). */
async function tellJoined(ctx: AppCtx, epicName: string, joined: readonly Feature[], closed: Map<string, string[]>): Promise<void> {
  for (const f of joined) {
    if (!leadToTell(ctx, f)) continue
    const whys = closed.get(f.id) ?? []
    const reask = whys.length
      ? ` What this feature waited on the human for was closed (${whys.map((w) => `"${w}"`).join('; ')}): re-ask it through the epic with hand_back.`
      : ''
    await deliverToLead(ctx, f, {
      source: 'runcastle',
      reason: whys.length ? 'question' : 'news',
      background: true,
      text:
        `This feature is on autopilot now, in the epic "${epicName}": the human watches but does not type here. ` +
        `Report to the epic with hand_back (questions, designs for a yes, ready to test, failures); it answers or asks the human.${reask}`,
    })
  }
}

/** Tell each formerly locked lead, once, that the feature is the human's again (decisions 6, 20). */
async function tellLeft(ctx: AppCtx, left: readonly Feature[]): Promise<void> {
  for (const f of left) {
    if (!isOpen(f) || !leadToTell(ctx, f)) continue
    await deliverToLead(ctx, f, {
      source: 'runcastle',
      reason: 'question',
      background: true,
      text: 'This feature is the human\'s again: autopilot is off for it. Re-ask any open question with wait_for_you.',
    })
  }
}

/**
 * Turn autopilot on for the epic, on the human's yes to its run plan
 * (decisions 1, 14): every open feature of the epic locks. A wait open in any
 * of their chats is closed, and each lead is told to re-ask through the epic
 * (decision 24). Refused when it is already on.
 */
export async function turnOn(ctx: AppCtx, epicId: string): Promise<AutopilotResult> {
  const epic = requireEpic(ctx, epicId)
  if (epic.autopilot) throw new GateError('this epic is already on autopilot, so nothing changed. "Also run X" is set_autopilot add.')
  ctx.db.update(sessions).set({ autopilot: true }).where(eq(sessions.id, epic.id)).run()
  const locked = openFeaturesOf(ctx, epic.id)
  const closed = closeWaits(ctx, locked)
  const name = chatName(epic)
  emitChange(
    ctx,
    epic,
    { epicId: epic.id, change: 'on', featureIds: locked.map((f) => f.id), autopilot: true, by: 'epic' },
    `"${name}" went on autopilot${locked.length ? `: ${locked.map((f) => f.slug).join(', ')} locked to it` : ''}`,
  )
  await tellJoined(ctx, name, locked, closed)
  return result(ctx, epic, locked, [])
}

/**
 * "Also run X" (decision 13): move features into this epic by re-pointing
 * their epic link. Refused for a shipped or archived feature, and for one
 * locked to another epic. On autopilot each moved feature locks at once, as
 * {@link turnOn} locks; off autopilot it only moves.
 */
export async function add(ctx: AppCtx, epicId: string, slugs: readonly string[]): Promise<AutopilotResult> {
  const epic = requireEpic(ctx, epicId)
  const list = featuresBySlug(ctx, epic.projectId as string, slugs)
  for (const f of list) {
    if (!isOpen(f)) throw new GateError(`\`${f.slug}\` is ${f.status}, so it cannot move into this epic; nothing changed.`)
    if (f.chatId && f.chatId !== epic.id && isLocked(ctx, f)) {
      throw new GateError(
        `\`${f.slug}\` is on autopilot in the epic "${chatNameOf(ctx, f.chatId)}", so it cannot move here while it is locked there; nothing changed. ` +
          'The human ends that autopilot first.',
      )
    }
  }
  const moving = list.filter((f) => f.chatId !== epic.id)
  const movedFrom = moving.map((f) => ({ slug: f.slug, from: f.chatId ? chatNameOf(ctx, f.chatId) : null }))
  if (moving.length) ctx.db.update(features).set({ chatId: epic.id }).where(inArray(features.id, moving.map((f) => f.id))).run()
  const moved = moving.map((f) => getFeatureRow(ctx, f.id))
  const on = !!epic.autopilot
  const closed = on ? closeWaits(ctx, moved) : new Map<string, string[]>()
  const name = chatName(epic)
  if (moved.length) {
    emitChange(
      ctx,
      epic,
      { epicId: epic.id, change: 'add', featureIds: moved.map((f) => f.id), autopilot: on, by: 'epic' },
      `"${name}" also runs ${moved.map((f) => f.slug).join(', ')}${on ? ' on autopilot' : ''}`,
    )
  }
  if (on) await tellJoined(ctx, name, moved, closed)
  return result(ctx, epic, moved, movedFrom)
}

/**
 * End autopilot (decisions 6, 8, 20): the epic's switch clears, one event, and
 * each formerly locked lead is told once that its feature is the human's again. `by: 'human'` is the lock note's
 * "End autopilot" link: the orchestrator did not call it, so it is told too.
 * Nothing running stops. Ending one that is off changes nothing and says so.
 */
export async function turnOff(ctx: AppCtx, epicId: string, opts: { by?: 'epic' | 'human' } = {}): Promise<AutopilotResult> {
  const by = opts.by ?? 'epic'
  const epic = requireEpic(ctx, epicId)
  if (!epic.autopilot) return result(ctx, epic, [], [])
  const run = openFeaturesOf(ctx, epic.id)
  ctx.db.update(sessions).set({ autopilot: false }).where(eq(sessions.id, epic.id)).run()
  const name = chatName(epic)
  emitChange(
    ctx,
    epic,
    { epicId: epic.id, change: 'off', featureIds: run.map((f) => f.id), autopilot: false, by },
    `"${name}" is off autopilot${by === 'human' ? ' (the human ended it)' : ''}: every feature is the human's again`,
  )
  await tellLeft(ctx, run)
  if (by === 'human' && mayStartInBackground(epic)) {
    const slugs = run.map((f) => f.slug)
    await agentHost(ctx).prompt(
      epic.id,
      {
        text:
          `[runcastle] The human ended autopilot for this epic from a feature's lock note. ` +
          `${slugs.length ? `${slugs.join(', ')} ${slugs.length === 1 ? 'is' : 'are'} the human's again; ` : ''}` +
          'stop answering for them, and do not message, drive or merge them. Their leads re-ask what is open in their own chats.',
      },
      { source: 'runcastle', display: { summary: 'You ended autopilot' } },
    )
  }
  return result(ctx, epic, run, [])
}

/**
 * Something the human would otherwise be asked on a locked feature (a lead's
 * `wait_for_you`, a dead lead run: decision 17) goes to its epic as a message
 * instead. Returns the epic's name; null when the feature is not locked, and
 * the caller sets the need on the feature as before.
 */
export async function tellEpicInstead(ctx: AppCtx, feature: Feature, text: string, words: string): Promise<string | null> {
  const lock = autopilotOf(ctx, feature)
  if (!lock) return null
  const epic = getSessionRow(ctx, lock.epicId)
  if (!epic || !mayStartInBackground(epic)) return lock.epicName
  await agentHost(ctx).prompt(
    epic.id,
    { text: `[runcastle] ${feature.slug} ${text}` },
    {
      source: 'runcastle',
      display: { news: [{ featureId: feature.id, title: feature.title, events: [{ tone: 'needsYou', words }] }] },
    },
  )
  return lock.epicName
}
