import type { ReviewFinding, ReviewFindingInput, Ticket } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { reviewFindings } from '../../src/db/schema'
import type { AppCtx } from '../../src/db/types'
import { buildFixTicket, listByFeature, reportFinding } from '../../src/services/review-findings'
import { storeTickets } from '../../src/services/tickets'

/**
 * Report a defect and give it the fix ticket a review used to mint for it —
 * blocked on the review, linked both ways. Reviews no longer mint
 * (`the-feature-lead-runs-rounds` decision 10), but features from before hold
 * exactly this shape, so the tests of what the findings ledger does with a
 * defect and its fix ticket seed it here.
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
