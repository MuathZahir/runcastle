import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { newId, type DesignApprover, type DesignEntry, type DesignState } from '@runcastle/core'
import { designPicturesDir } from '@runcastle/core/paths'
import { and, asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { designs, features } from '../db/schema'
import { GateError, NotFoundError } from '../errors'
import { SHOWN_TYPES, storedExt } from '../threads/shown'
import { emit } from './events'
import { featureDocPath } from './feature-docs'
import { deliverToLead } from './lead-delivery'
import { getFeatureRow, projectForFeature } from './repo'
import { listByFeature } from './tickets'

/**
 * Runcastle's own record of a feature's designs and of its plan being shown
 * (designs-and-the-plan-get-their-own-place decisions 1, 8, 10, 17, 18, 25).
 * The agent records with `show_design` / `show_plan`, the human approves and
 * opens through tRPC; the Design tab's list, the cards, the lead's context and
 * the "Design to approve" need all read it. Every write emits.
 */

type DesignRow = typeof designs.$inferSelect

/** Where a design's picture copy is served from. */
function pictureUrl(featureId: string, picture: string): string {
  return `/api/designs/${featureId}/pictures/${basename(picture)}`
}

const FEATURE_ID = /^[A-Za-z0-9_-]+$/
const PICTURE_FILE = /^[A-Za-z0-9_-]+\.[a-z0-9]{1,10}$/

/** The stored picture `file` of a feature, or null for a name this record never writes. */
export function designPicturePath(featureId: string, file: string): string | null {
  if (!FEATURE_ID.test(featureId) || !PICTURE_FILE.test(file)) return null
  return join(designPicturesDir(featureId), file)
}

/** A design page as recorded: always from the server's root. */
function pagePath(path: string): string {
  const trimmed = path.trim()
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Copy a picture of a design into runcastle's own store, so its card keeps it
 * after the agent's file is gone. `real` is a file already checked as one an
 * agent may show (`showableFile`); only an image is taken.
 */
export function copyDesignPicture(featureId: string, real: string): string {
  const ext = storedExt(real)
  if (!SHOWN_TYPES[ext]?.startsWith('image/')) {
    throw new GateError(`${real} is not a picture: show_design takes a png, jpg, gif, webp or svg as its picture`)
  }
  const dir = designPicturesDir(featureId)
  mkdirSync(dir, { recursive: true })
  const stored = join(dir, `${newId('pic')}.${ext}`)
  copyFileSync(real, stored)
  return stored
}

function designRow(ctx: AppCtx, designId: string): DesignRow {
  const row = ctx.db.select().from(designs).where(eq(designs.id, designId)).get()
  if (!row) throw new NotFoundError(`design ${designId} not found`)
  return row
}

function designRows(ctx: AppCtx, featureId: string): DesignRow[] {
  return ctx.db.select().from(designs).where(eq(designs.featureId, featureId)).orderBy(asc(designs.createdAt)).all()
}

/** Opened by the human since it was last shown. */
function opened(row: Pick<DesignRow, 'seenAt' | 'shownAt'>): boolean {
  return row.seenAt !== null && row.seenAt >= row.shownAt
}

function toEntry(row: DesignRow): DesignEntry {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.picture !== null ? { picture: pictureUrl(row.featureId, row.picture) } : {}),
    state: row.state,
    isNew: !opened(row),
    shownAt: row.shownAt,
  }
}

/** What a design event carries. */
function designData(row: DesignRow): { designId: string; path: string; title: string; state: DesignState } {
  return { designId: row.id, path: row.path, title: row.title, state: row.state }
}

/**
 * Record a design the agent showed: one entry per page, so showing a page again
 * updates it, sets it back to waiting and makes it new to the human again
 * (decision 18). `picture` is the stored copy, or none for this showing.
 */
export function recordDesign(
  ctx: AppCtx,
  featureId: string,
  input: { path: string; title: string; width?: number | undefined; picture?: string | undefined },
): DesignEntry {
  const path = pagePath(input.path)
  const now = Date.now()
  const shown = {
    title: input.title.trim(),
    width: input.width ?? null,
    picture: input.picture ?? null,
    state: 'waiting' as const,
    approvedBy: null,
    shownAt: now,
    seenAt: null,
  }
  const known = ctx.db
    .select({ id: designs.id })
    .from(designs)
    .where(and(eq(designs.featureId, featureId), eq(designs.path, path)))
    .get()
  if (known) ctx.db.update(designs).set(shown).where(eq(designs.id, known.id)).run()
  else ctx.db.insert(designs).values({ id: newId('design'), featureId, path, createdAt: now, ...shown }).run()
  const row = ctx.db
    .select()
    .from(designs)
    .where(and(eq(designs.featureId, featureId), eq(designs.path, path)))
    .get()!
  emit(ctx, featureId, {
    type: 'design.shown',
    message: `design shown: ${row.title}${known ? ' (again — waiting for the human)' : ''}`,
    data: designData(row),
  })
  return toEntry(row)
}

/** The feature's design at `path`, or a refusal naming the pages it has. */
function designAt(ctx: AppCtx, featureId: string, path: string): DesignRow {
  const page = pagePath(path)
  const rows = designRows(ctx, featureId)
  const row = rows.find((r) => r.path === page)
  if (row) return row
  throw new GateError(
    rows.length
      ? `no design is recorded at ${page}. Recorded: ${rows.map((r) => r.path).join(', ')}`
      : `no design is recorded at ${page}: record it with show_design first`,
  )
}

/**
 * The lead marks a yes or a rejection the human gave in words (decisions 8,
 * 20): approved by the lead, or dropped.
 */
export function setDesignState(
  ctx: AppCtx,
  featureId: string,
  input: { path: string; state: 'approved' | 'dropped' },
): DesignEntry {
  const row = designAt(ctx, featureId, input.path)
  const approvedBy: DesignApprover | null = input.state === 'approved' ? 'lead' : null
  ctx.db.update(designs).set({ state: input.state, approvedBy }).where(eq(designs.id, row.id)).run()
  const updated = designRow(ctx, row.id)
  emit(ctx, featureId, {
    type: 'design.state',
    message: `design ${input.state} (marked by the agent): ${updated.title}`,
    data: { ...designData(updated), approvedBy },
  })
  return toEntry(updated)
}

/** The one line the lead hears when the human's click approves the last waiting design (decision 25). */
export function allApprovedLine(approved: readonly Pick<DesignRow, 'title' | 'path'>[]): string {
  const named = approved.map((d) => `“${d.title}” (${d.path})`).join(', ')
  const count = approved.length === 1 ? 'the 1 design' : `all ${approved.length} designs`
  return (
    `[runcastle] The human approved ${count} in the Design tab: ${named}. ` +
    'Commit each one not yet committed as "design: <title>".'
  )
}

/**
 * The human's Approve click (decisions 8, 24, 25). Quiet while other designs
 * still wait; the click that leaves none waiting tells the lead once, naming
 * every approved design. A design not waiting (already approved, dropped) is
 * left alone and tells nobody, so a double click never sends twice.
 */
export async function approveDesign(ctx: AppCtx, designId: string): Promise<{ approved: boolean }> {
  const row = designRow(ctx, designId)
  if (row.state !== 'waiting') return { approved: false }
  ctx.db.update(designs).set({ state: 'approved', approvedBy: 'human' }).where(eq(designs.id, designId)).run()
  emit(ctx, row.featureId, {
    type: 'design.approved',
    message: `design approved by the human: ${row.title}`,
    data: { ...designData({ ...row, state: 'approved' }), approvedBy: 'human' },
  })
  const rows = designRows(ctx, row.featureId)
  if (!rows.some((r) => r.state === 'waiting')) {
    const approved = rows.filter((r) => r.state === 'approved')
    await deliverToLead(ctx, getFeatureRow(ctx, row.featureId), { text: allApprovedLine(approved), source: 'runcastle' })
  }
  return { approved: true }
}

/** The human opened a design (decision 10): no longer new until it is shown again. */
export function markDesignSeen(ctx: AppCtx, designId: string): DesignEntry {
  const row = designRow(ctx, designId)
  ctx.db.update(designs).set({ seenAt: Date.now() }).where(eq(designs.id, designId)).run()
  const updated = designRow(ctx, designId)
  emit(ctx, row.featureId, { type: 'design.seen', message: `design opened: ${row.title}`, data: designData(updated) })
  return toEntry(updated)
}

/** The lead showed the plan: new to the human again until they open it. */
export function markPlanShown(ctx: AppCtx, featureId: string): void {
  ctx.db.update(features).set({ planShownAt: Date.now(), planSeenAt: null }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, { type: 'plan.shown', message: 'plan shown in the chat' })
}

/** The human opened the plan (the Plan tab or its card). */
export function markPlanSeen(ctx: AppCtx, featureId: string): void {
  getFeatureRow(ctx, featureId)
  ctx.db.update(features).set({ planSeenAt: Date.now() }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, { type: 'plan.seen', message: 'plan opened' })
}

/** Whether the plan was shown since the human last opened it. */
export function planIsNew(ctx: AppCtx, featureId: string): boolean {
  const row = ctx.db
    .select({ shownAt: features.planShownAt, seenAt: features.planSeenAt })
    .from(features)
    .where(eq(features.id, featureId))
    .get()
  return !!row && row.shownAt !== null && (row.seenAt === null || row.seenAt < row.shownAt)
}

/** The feature's designs, oldest recorded first; the web orders them for the list. */
export function listDesigns(ctx: AppCtx, featureId: string): DesignEntry[] {
  return designRows(ctx, featureId).map(toEntry)
}

/** A design as the lead reads it in `get_feature_context` (decision 10). */
export interface LeadDesign {
  title: string
  path: string
  state: DesignState
  approvedBy: DesignApprover | null
  /** The human opened it since it was last shown. */
  opened: boolean
}

export function leadDesigns(ctx: AppCtx, featureId: string): LeadDesign[] {
  return designRows(ctx, featureId).map((row) => ({
    title: row.title,
    path: row.path,
    state: row.state,
    approvedBy: row.approvedBy,
    opened: opened(row),
  }))
}

/** What the plan card counts (decision 5); `tickets` null when the agent builds the feature itself. */
export interface PlanFigures {
  decisions: number
  checkFirst: number
  tickets: number | null
  designs: number
}

/**
 * decisions.md's figures: its `## n.` headings, and how many numbers sit on
 * its `Check first: 17, 6, 3` line (0 without one — the card then leaves it out).
 */
export function decisionFigures(markdown: string): Pick<PlanFigures, 'decisions' | 'checkFirst'> {
  const decisions = markdown.split(/\r?\n/).filter((line) => /^## \d+\./.test(line)).length
  const checkLine = /^Check first:(.*)$/m.exec(markdown)?.[1] ?? ''
  return { decisions, checkFirst: checkLine.match(/\d+/g)?.length ?? 0 }
}

/** The plan card's figures, read from the feature's decisions.md, its tickets and the design record. */
export function planFigures(ctx: AppCtx, featureId: string): PlanFigures {
  const feature = getFeatureRow(ctx, featureId)
  const path = featureDocPath(projectForFeature(ctx, feature), feature, 'decisions.md')
  const markdown = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const tickets = listByFeature(ctx, featureId).filter((t) => t.kind === 'implementation').length
  return {
    ...decisionFigures(markdown),
    tickets: tickets > 0 ? tickets : null,
    designs: designRows(ctx, featureId).length,
  }
}

/** How many designs wait for the human, and since when the oldest of them was shown (decision 17). */
export function designsWaiting(ctx: AppCtx, featureId: string): { count: number; since: number | null } {
  const waiting = designRows(ctx, featureId).filter((r) => r.state === 'waiting')
  return { count: waiting.length, since: waiting.length ? Math.min(...waiting.map((r) => r.shownAt)) : null }
}
