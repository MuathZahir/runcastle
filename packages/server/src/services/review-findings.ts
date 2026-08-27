import type { FixProgress, ReviewFinding, ReviewFindingInput, Ticket, TicketInput } from '@runcastle/core'
import { ReviewFinding as ReviewFindingSchema, newId } from '@runcastle/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { reviewFindings } from '../db/schema'
import { NotFoundError } from '../errors'
import { emit } from './events'
import { getFeatureRow } from './repo'
import { storeTickets } from './tickets'

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

/**
 * Drive a finding through its fix ticket's lifecycle. The burn knows a ticket
 * status and a finding id and nothing else about findings, so the mapping from
 * one to the other lives here rather than in the scheduler.
 */
export function markFixProgress(
  ctx: AppCtx,
  findingId: string,
  progress: FixProgress,
  reason?: string,
): ReviewFinding {
  if (progress === 'fixing') return markFixing(ctx, findingId)
  if (progress === 'fixed') return markFixed(ctx, findingId)
  return markFailed(ctx, findingId, reason)
}

export function dismiss(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'dismissed',
    openReason: null,
    failureReason: null,
  })
}
