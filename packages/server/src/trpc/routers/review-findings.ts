import * as z from 'zod'
import { burn } from '../../services/features'
import { dismiss, promoteOpenDefects, reopenFinding, viewByFeature } from '../../services/review-findings'
import { listByIds } from '../../services/tickets'
import { publicProcedure, router } from '../context'

/**
 * The review agent's structured findings (spec "Review findings are fixed
 * in-run"): what it found, typed `defect` or `observation`, with the counts the
 * review page's lead card reads. Thin pass-throughs like the notes router — the
 * service owns the store, the summary and the events.
 *
 * `fixOpenDefects` is the one composite: minting the fix tickets belongs to the
 * findings service, but burning them is the Fix verb the FEATURE service owns
 * (review → implementation loop-back), so the two are joined here rather than
 * by one service reaching into the other.
 */
export const reviewFindingsRouter = router({
  listByFeature: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => viewByFeature(ctx, input.featureId)),

  dismiss: publicProcedure
    .input(z.object({ findingId: z.string() }))
    .mutation(({ ctx, input }) => dismiss(ctx, input.findingId)),

  // The other half of carry, and the human's alone: a lap session may park a
  // defect but never un-park one, so the carried pile only grows back into the
  // open count when a person says so.
  reopen: publicProcedure
    .input(z.object({ findingId: z.string() }))
    .mutation(({ ctx, input }) => reopenFinding(ctx, input.findingId)),

  // One click, no dialog (decisions #7): every open defect becomes a fix ticket
  // on this lap and the burn starts on the spot. Minting first means a burn that
  // cannot start (a session already live, say) surfaces as an error over tickets
  // that are already there — the bar's own "Burn N tickets" then runs them.
  fixOpenDefects: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const promoted = promoteOpenDefects(ctx, input.featureId)
      const { runId } = await burn(ctx, input.featureId)
      // The burn opens the lap these tickets burn in and carries them onto it,
      // so the rows minted a moment ago are stale before this returns.
      const tickets = listByIds(ctx, promoted.tickets.map((ticket) => ticket.id))
      return { ...promoted, tickets, runId }
    }),
})
