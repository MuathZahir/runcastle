import * as z from 'zod'
import { listAfter } from '../../services/events'
import { publicProcedure, router } from '../context'

export const eventsRouter = router({
  // The UI polls this at 1.5s using the last-seen event id as `afterId`.
  list: publicProcedure
    .input(z.object({ featureId: z.string(), afterId: z.number().optional() }))
    .query(({ ctx, input }) => listAfter(ctx, input.featureId, input.afterId)),
})
