import type { ReviewFinding, ReviewFindingInput, Ticket, TicketInput } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { reviewFindings } from '../../src/db/schema'
import type { AppCtx } from '../../src/db/types'
import { emit } from '../../src/services/events'
import { listByFeature, reportFinding } from '../../src/services/review-findings'
import { storeTickets } from './tickets'

/**
 * Seeds for findings that carry the shape the retired burn gave them: a fix
 * ticket and its lifecycle. Nothing in `src` writes these any more, but
 * features from before hold them, so the tests of what the findings ledger does
 * with such a defect seed them here.
 */

/** The mechanical fix ticket the burn minted from a finding. */
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

type StatusPatch = Pick<typeof reviewFindings.$inferInsert, 'status'> &
  Partial<Pick<typeof reviewFindings.$inferInsert, 'openReason' | 'failureReason' | 'resolvedBy' | 'resolutionNote'>>

function updateStatus(ctx: AppCtx, findingId: string, patch: StatusPatch): ReviewFinding {
  const current = ctx.db.select().from(reviewFindings).where(eq(reviewFindings.id, findingId)).get()!
  ctx.db
    .update(reviewFindings)
    .set({ resolvedBy: null, resolutionNote: null, ...patch })
    .where(eq(reviewFindings.id, findingId))
    .run()
  emit(ctx, current.featureId, {
    type: 'finding.updated',
    message: `finding ${findingId} marked ${patch.status}`,
    data: { findingId, status: patch.status, reason: patch.failureReason },
  })
  return listByFeature(ctx, current.featureId).find((f) => f.id === findingId)!
}

export function markFixing(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, { status: 'fixing', openReason: null, failureReason: null })
}

export function markFixed(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, { status: 'fixed', openReason: null, failureReason: null, resolvedBy: 'fix-ticket' })
}

export function markFailed(ctx: AppCtx, findingId: string, reason?: string): ReviewFinding {
  return updateStatus(ctx, findingId, { status: 'failed', openReason: 'fix-failed', failureReason: reason ?? null })
}

/**
 * Report a defect and give it the fix ticket a review used to mint for it —
 * blocked on the review, linked both ways.
 */
export function reportWithFixTicket(
  ctx: AppCtx,
  args: { featureId: string; reviewTicket: Ticket; input: ReviewFindingInput },
): { finding: ReviewFinding; fixTicket: Ticket } {
  const { finding } = reportFinding(ctx, args)
  const [fixTicket] = storeTickets(ctx, args.featureId, [
    { ...buildFixTicket(finding), blockedBy: [args.reviewTicket.seq] },
  ], { blockedByAreGlobal: true })
  ctx.db.update(reviewFindings).set({ fixTicketId: fixTicket.id }).where(eq(reviewFindings.id, finding.id)).run()
  return { finding: listByFeature(ctx, args.featureId).find((f) => f.id === finding.id)!, fixTicket }
}
