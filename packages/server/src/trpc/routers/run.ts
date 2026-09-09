import * as z from 'zod'
import { readTranscript } from '../../services/agent-stream'
import { emit } from '../../services/events'
import { getRunRow } from '../../services/repo'
import { getRunWithTickets, listRunSummaries } from '../../services/runs'
import { cancelRun } from '../../workflows/runner'
import { publicProcedure, router } from '../context'

export const runRouter = router({
  // The run row plus the ticket rows this run burned, so a run that has already
  // finished can still draw its lanes (decision #15b). The tickets ride along
  // rather than sitting on their own procedure because there is no reader of
  // one without the other.
  get: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => getRunWithTickets(ctx, input.runId)),

  /** Every run of a feature, newest first — what the runs counter opens. */
  listByFeature: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => listRunSummaries(ctx, input.featureId)),

  // Live agent transcript for one burning (or recently burned) ticket — the
  // unthrottled sandcastle stream captured in memory by services/agent-stream.
  // Cursor poll: pass the highest chunk index you have as `after` and only
  // newer chunks come back. Unknown ticket → empty result, never an error
  // (transcripts are ephemeral; a server restart legitimately forgets them).
  agentTranscript: publicProcedure
    .input(z.object({ ticketId: z.string(), after: z.number().int().optional() }))
    .query(({ input }) => readTranscript(input.ticketId, input.after ?? -1)),

  // W2 additive (UI-SPEC §6): wired to A1's per-run AbortController map in
  // workflows/runner.ts via the existing `cancelRun` export. An unknown run id
  // is NOT_FOUND (via `getRunRow`, like every other run lookup) — reporting
  // `{ok:true}` for a run this server has never heard of told the UI a cancel
  // landed when nothing was cancelled. A run that exists but has already
  // finished stays a no-op: it is genuinely already not running.
  cancel: publicProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = getRunRow(ctx, input.runId)
      // Resolves only once every agent of the run is confirmed dead, so the
      // button's pending state is an honest "stopping…".
      const { confirmed } = await cancelRun(input.runId)
      // An agent that outlived the kill's deadline: the run reads cancelled but
      // something of it may still be burning, and the timeline has to hold that
      // rather than the response alone (the toast is gone in seconds).
      if (!confirmed) {
        emit(ctx, run.featureId, {
          type: 'run.cancel_timeout',
          message: 'cancel timed out — an agent of this run may still be running',
          runId: run.id,
        })
      }
      return { ok: true, confirmed }
    }),
})
