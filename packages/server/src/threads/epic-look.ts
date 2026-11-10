import {
  type EpicColor,
  type EpicIconId,
  type Feature,
  leastUsedEpicColor,
  type SessionRow,
  type ThreadEntry,
} from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { sessions } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, NotFoundError } from '../errors'
import { getSessionRow } from '../launcher/sessions'
import { emitForSession } from '../services/events'
import { list as listFeatures } from '../services/features'
import { listThreads } from './read'

/**
 * An epic's look on the server (docs/features/epics-that-look-alive): the
 * colour a new project chat takes, the human's pick, and the orchestrator's
 * icon. Stored on the chat's session row; every change emits an event, which
 * invalidates the thread lists at once.
 */

/** How long the human's words keep a chat listed: the sidebar's `WRITTEN_KEEPS_LISTED_MS`. */
const WRITTEN_KEEPS_LISTED_MS = 24 * 60 * 60 * 1000

/**
 * Whether the sidebar lists an epic now, as the web's `threadIsActive` reads it
 * (minus the chat in front and unsent drafts, which only the browser knows):
 * working or asking, a feature it cut (`chatId`) in motion or up next, or
 * written in by the human in the last day. The epic list keys on origin, so
 * this does too, where the naming pass's older `chatIsListed` keys on holder.
 */
export function epicIsListed(
  thread: ThreadEntry,
  features: readonly Pick<Feature, 'chatId' | 'status' | 'upNext'>[],
  now: number,
): boolean {
  return (
    thread.state !== 'idle' ||
    features.some((f) => f.chatId === thread.id && (f.status === 'active' || (f.status === 'draft' && f.upNext))) ||
    (thread.lastHumanAt !== undefined && now - thread.lastHumanAt < WRITTEN_KEEPS_LISTED_MS)
  )
}

/**
 * The colour a project's new chat takes when its row is created (decision 2):
 * the one least used among the project's epics listed now
 * ({@link epicIsListed}), ties broken by the palette's order.
 */
export function newEpicColor(ctx: AppCtx, projectId: string, now: number = Date.now()): EpicColor {
  const features = listFeatures(ctx, projectId)
  const taken = listThreads(ctx, { projectId })
    .filter((t) => t.role === 'project' && epicIsListed(t, features, now))
    .map((t) => t.color)
  return leastUsedEpicColor(taken)
}

/** Stamp a fresh project chat's colour. Called right after its row is created; never again by itself. */
export function assignEpicColor(ctx: AppCtx, row: SessionRow): SessionRow {
  if (row.kind !== 'project' || !row.projectId || row.epicColor) return row
  const color = newEpicColor(ctx, row.projectId)
  ctx.db.update(sessions).set({ epicColor: color }).where(eq(sessions.id, row.id)).run()
  return { ...row, epicColor: color }
}

function epicRow(ctx: AppCtx, threadId: string): SessionRow {
  const row = getSessionRow(ctx, threadId)
  if (!row) throw new NotFoundError(`thread ${threadId} not found`)
  if (row.kind !== 'project') throw new GateError('only an epic (a project chat) has a colour and an icon')
  return row
}

/**
 * The human's pick in "Colour and icon…" (decision 3): sets the colour, the
 * icon, or both. An icon picked here is the human's: `name_epic` never changes
 * it again.
 */
export function setEpicLook(
  ctx: AppCtx,
  threadId: string,
  look: { color?: EpicColor; icon?: EpicIconId },
): Pick<ThreadEntry, 'color' | 'icon' | 'iconByHuman'> {
  const row = epicRow(ctx, threadId)
  const set = {
    ...(look.color ? { epicColor: look.color } : {}),
    ...(look.icon ? { epicIcon: look.icon, epicIconByHuman: true } : {}),
  }
  if (Object.keys(set).length === 0) throw new GateError('pick a colour or an icon')
  ctx.db.update(sessions).set(set).where(eq(sessions.id, row.id)).run()
  emitForSession(ctx, row, {
    type: 'session.epic_look_set',
    message: 'the human changed an epic’s colour or icon',
    data: { sessionId: row.id, ...look },
  })
  const color = look.color ?? row.epicColor
  const icon = look.icon ?? row.epicIcon
  return {
    ...(color ? { color } : {}),
    ...(icon ? { icon } : {}),
    ...(look.icon || row.epicIconByHuman ? { iconByHuman: true } : {}),
  }
}

/**
 * The orchestrator's icon (`name_epic`, decision 1): set unless the human
 * picked one. Answers whether it applied; emits when it did.
 */
export function writeEpicIcon(ctx: AppCtx, threadId: string, icon: EpicIconId): { applied: true } | { applied: false; humanIcon: EpicIconId | null } {
  const row = epicRow(ctx, threadId)
  if (row.epicIconByHuman) return { applied: false, humanIcon: row.epicIcon ?? null }
  ctx.db.update(sessions).set({ epicIcon: icon }).where(eq(sessions.id, row.id)).run()
  emitForSession(ctx, row, {
    type: 'session.epic_icon_named',
    message: 'the orchestrator picked its epic’s icon',
    data: { sessionId: row.id, icon },
  })
  return { applied: true }
}
