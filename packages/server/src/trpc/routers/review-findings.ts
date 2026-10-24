import * as z from 'zod'
import { dismiss, viewByFeature } from '../../services/review-findings'
import { publicProcedure, router } from '../context'

/**
 * The review agent's structured findings (spec "Review findings are fixed
 * in-run"): what it found, typed `defect` or `observation`, with the counts the
 * review page's lead card reads. Thin pass-throughs like the notes router — the
 * service owns the store, the summary and the events.
 */
export const reviewFindingsRouter = router({
  listByFeature: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => viewByFeature(ctx, input.featureId)),

  dismiss: publicProcedure
    .input(z.object({ findingId: z.string() }))
    .mutation(({ ctx, input }) => dismiss(ctx, input.findingId)),
})
