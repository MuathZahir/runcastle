import * as z from 'zod'
import { burn } from '../../services/features'
import { dismiss, promoteOpenDefects, viewByFeature } from '../../services/review-findings'
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

  // One click, no dialog (decisions #7): every open defect becomes a fix ticket
  // on this lap and the burn starts on the spot. Minting first means a burn that
  // cannot start (a session already live, say) surfaces as an error over tickets
  // that are already there — the bar's own "Burn N tickets" then runs them.
  fixOpenDefects: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const promoted = promoteOpenDefects(ctx, input.featureId)
      const { runId } = await burn(ctx, input.featureId)
      return { ...promoted, runId }
    }),
})
