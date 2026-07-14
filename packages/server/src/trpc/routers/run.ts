import * as z from 'zod'
import { getRunRow } from '../../services/repo'
import { publicProcedure, router } from '../context'

export const runRouter = router({
  get: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => getRunRow(ctx, input.runId)),
})
