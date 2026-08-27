import type { ReviewFinding, ReviewFindingInput, Ticket, TicketInput } from '@runcastle/core'
import { ReviewFinding as ReviewFindingSchema, newId } from '@runcastle/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { reviewFindings } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { getFeatureRow } from './repo'
import { listByFeature as listTickets, storeTickets } from './tickets'

const AUTO_FIX_CAP = 8
type FindingRow = typeof reviewFindings.$inferSelect

function rowToFinding(row: FindingRow): ReviewFinding {
  return ReviewFindingSchema.parse(row)
}

function getFinding(ctx: AppCtx, id: string): ReviewFinding {
  const row = ctx.db.select().from(reviewFindings).where(eq(reviewFindings.id, id)).get()
  if (!row) throw new NotFoundError(`review finding ${id} not found`)
  return rowToFinding(row)
}

export function listByFeature(ctx: AppCtx, featureId: string): ReviewFinding[] {
  return ctx.db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.featureId, featureId))
    .orderBy(asc(reviewFindings.createdAt), asc(reviewFindings.id))
    .all()
    .map(rowToFinding)
}

export function buildFixTicket(
  finding: Pick<ReviewFinding, 'id' | 'title' | 'location' | 'citation' | 'detail' | 'reproStep'>,
): TicketInput {
  return {
    title: finding.title,
    goal: `Fix: ${finding.title}`,
    context: [
      `Location: ${finding.location}`,
      `Citation: ${finding.citation}`,
      `Detail: ${finding.detail}`,
      `Repro step: ${finding.reproStep}`,
    ].join('\n\n'),
    acceptanceCriteria: [
      `The repro step no longer reproduces / the cited criterion holds: ${finding.reproStep}`,
    ],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    originFindingId: finding.id,
  }
}

export function reportFinding(
  ctx: AppCtx,
  args: { featureId: string; reviewTicket: Ticket; input: ReviewFindingInput },
): { finding: ReviewFinding; fixTicket: Ticket | null; overCap: boolean } {
  const { featureId, reviewTicket, input } = args
  const feature = getFeatureRow(ctx, featureId)
  const id = newId('finding')
  const ticketCount = ctx.db
    .select({ id: reviewFindings.id })
    .from(reviewFindings)
    .where(
      and(
        eq(reviewFindings.reviewTicketId, reviewTicket.id),
        isNotNull(reviewFindings.fixTicketId),
      ),
    )
    .all().length
  const overCap = input.kind === 'defect' && ticketCount >= AUTO_FIX_CAP

  ctx.db
    .insert(reviewFindings)
    .values({
      id,
      featureId,
      lap: feature.lap,
      reviewTicketId: reviewTicket.id,
      ...input,
      reproStep: input.reproStep ?? '',
      status: 'open',
      openReason: overCap ? 'over-cap' : null,
      failureReason: null,
      fixTicketId: null,
      createdAt: Date.now(),
    })
    .run()

  let fixTicket: Ticket | null = null
  if (input.kind === 'defect' && !overCap) {
    const finding = getFinding(ctx, id)
    fixTicket = storeTickets(ctx, featureId, [
      { ...buildFixTicket(finding), blockedBy: [reviewTicket.seq] },
    ], { blockedByAreGlobal: true })[0]
    ctx.db
      .update(reviewFindings)
      .set({ fixTicketId: fixTicket.id })
      .where(eq(reviewFindings.id, id))
      .run()
  }

  const finding = getFinding(ctx, id)
  emit(ctx, featureId, {
    type: 'finding.reported',
    message: `${input.kind} reported: ${input.title}`,
    ticketId: fixTicket?.id,
    data: { findingId: id, fixTicketId: fixTicket?.id, overCap },
  })
  return { finding, fixTicket, overCap }
}

function updateStatus(
  ctx: AppCtx,
  findingId: string,
  patch: Pick<FindingRow, 'status' | 'openReason' | 'failureReason'>,
): ReviewFinding {
  const current = getFinding(ctx, findingId)
  ctx.db.update(reviewFindings).set(patch).where(eq(reviewFindings.id, findingId)).run()
  emit(ctx, current.featureId, {
    type: 'finding.updated',
    message: `finding ${findingId} marked ${patch.status}`,
    data: { findingId, status: patch.status, reason: patch.failureReason },
  })
  return getFinding(ctx, findingId)
}

export function markFixing(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'fixing',
    openReason: null,
    failureReason: null,
  })
}

export function markFixed(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'fixed',
    openReason: null,
    failureReason: null,
  })
}

export function markFailed(ctx: AppCtx, findingId: string, reason?: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'failed',
    openReason: 'fix-failed',
    failureReason: reason ?? null,
  })
}

export function dismiss(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'dismissed',
    openReason: null,
    failureReason: null,
  })
}

/**
 * Where a defect stands, read off the finding AND the fix ticket it minted.
 *
 * The join is what makes the counts unable to lie (decisions #9): the finding's
 * own status is written by the burner, so a burner that landed the fix without
 * getting as far as stamping the row would otherwise leave a fixed defect
 * showing as open — and a click on "Fix the open defects" would mint a second
 * ticket for work that is already on the branch. A live ticket (pending or
 * burning) is `fixing` for the same reason: the fix has not been given up on,
 * so it is not the human's problem yet.
 */
type DefectState = 'fixed' | 'open' | 'fixing' | 'dismissed'

function defectState(finding: ReviewFinding, fixTicket: Ticket | undefined): DefectState {
  if (finding.status === 'dismissed') return 'dismissed'
  if (finding.status === 'fixed' || fixTicket?.status === 'done') return 'fixed'
  if (fixTicket && fixTicket.status !== 'failed' && fixTicket.status !== 'cancelled') {
    return 'fixing'
  }
  return finding.status === 'open' || finding.status === 'failed' ? 'open' : 'fixing'
}

/**
 * The counts line the review page leads with (decisions #7): "9 defects found ·
 * 8 fixed automatically · 1 still open · 3 observations". Computed here and
 * never written by an agent, so it cannot disagree with the list beneath it.
 *
 * `found` is every defect the review reported, dismissed ones included — a
 * defect the human waved away was still found.
 */
export interface FindingSummary {
  found: number
  fixed: number
  open: number
  observations: number
}

export interface FindingsView {
  findings: ReviewFinding[]
  summary: FindingSummary
}

/** The findings of a feature with their computed summary — the page's read model. */
export function viewByFeature(ctx: AppCtx, featureId: string): FindingsView {
  const findings = listByFeature(ctx, featureId)
  const tickets = listTickets(ctx, featureId)
  const summary: FindingSummary = { found: 0, fixed: 0, open: 0, observations: 0 }
  for (const finding of findings) {
    if (finding.kind === 'observation') {
      summary.observations += 1
      continue
    }
    summary.found += 1
    const state = defectState(finding, fixTicketOf(finding, tickets))
    if (state === 'fixed') summary.fixed += 1
    else if (state === 'open') summary.open += 1
  }
  return { findings, summary }
}

function fixTicketOf(finding: ReviewFinding, tickets: Ticket[]): Ticket | undefined {
  return finding.fixTicketId ? tickets.find((t) => t.id === finding.fixTicketId) : undefined
}

/** The defects the summary counts as `open` — what the Fix button acts on. */
export function openDefects(ctx: AppCtx, featureId: string): ReviewFinding[] {
  const tickets = listTickets(ctx, featureId)
  return listByFeature(ctx, featureId).filter(
    (f) => f.kind === 'defect' && defectState(f, fixTicketOf(f, tickets)) === 'open',
  )
}

/**
 * "Fix N open defects" (decisions #7): mint one fix ticket per open defect on
 * the CURRENT lap and flip each finding to `fixing`. The tickets are built by
 * the same mechanical {@link buildFixTicket} the auto-fix path uses — the
 * finding already contains everything a ticket needs (decisions #8) — and carry
 * no `blockedBy`: the review that would have blocked them is long done.
 *
 * Minting only. The burn that runs them is the Fix verb the feature service
 * owns, and the router fires it right after this returns.
 */
export function promoteOpenDefects(
  ctx: AppCtx,
  featureId: string,
): { findings: ReviewFinding[]; tickets: Ticket[] } {
  const defects = openDefects(ctx, featureId)
  if (defects.length === 0) throw new InvalidInputError('no open defects to fix')

  const tickets = storeTickets(ctx, featureId, defects.map(buildFixTicket))
  const findings = defects.map((defect, index) => {
    ctx.db
      .update(reviewFindings)
      .set({
        status: 'fixing',
        openReason: null,
        failureReason: null,
        fixTicketId: tickets[index].id,
      })
      .where(eq(reviewFindings.id, defect.id))
      .run()
    return getFinding(ctx, defect.id)
  })

  emit(ctx, featureId, {
    type: 'finding.fixing',
    message: `${findings.length} open defect${findings.length === 1 ? '' : 's'} promoted to fix ticket${
      tickets.length === 1 ? ` ${tickets[0].seq}` : `s ${tickets.map((t) => t.seq).join(', ')}`
    }`,
    data: { findingIds: findings.map((f) => f.id), seqs: tickets.map((t) => t.seq) },
  })
  return { findings, tickets }
}
