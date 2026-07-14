import * as z from 'zod'
import { getRunRow } from '../../services/repo'
import { cancelRun } from '../../workflows/runner'
import { publicProcedure, router } from '../context'

export const runRouter = router({
  get: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => getRunRow(ctx, input.runId)),

  // W2 additive (UI-SPEC §6): wired to A1's per-run AbortController map in
  // workflows/runner.ts via the existing `cancelRun` export. No-op if the run
  // is unknown or already finished.
  cancel: publicProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(({ input }) => {
      cancelRun(input.runId)
      return { ok: true }
    }),
})
