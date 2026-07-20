import * as z from 'zod'
import { readTranscript } from '../../services/agent-stream'
import { getRunRow } from '../../services/repo'
import { cancelRun } from '../../workflows/runner'
import { publicProcedure, router } from '../context'

export const runRouter = router({
  get: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => getRunRow(ctx, input.runId)),

  // Live agent transcript for one burning (or recently burned) ticket — the
  // unthrottled sandcastle stream captured in memory by services/agent-stream.
  // Cursor poll: pass the highest chunk index you have as `after` and only
  // newer chunks come back. Unknown ticket → empty result, never an error
  // (transcripts are ephemeral; a server restart legitimately forgets them).
  agentTranscript: publicProcedure
    .input(z.object({ ticketId: z.string(), after: z.number().int().optional() }))
    .query(({ input }) => readTranscript(input.ticketId, input.after ?? -1)),

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
