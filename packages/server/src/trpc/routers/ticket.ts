import * as z from 'zod'
import { retryTicket } from '../../services/features'
import { cancelTicket } from '../../services/tickets'
import { stopTicketRun } from '../../workflows/ticket-burner'
import { publicProcedure, router } from '../context'

/**
 * Per-ticket burn controls (the burn-robustness pass). The whole-feature
 * actions stay on their existing routers (`feature.burn` re-burns everything,
 * `run.cancel` kills a run); these are the surgical tools:
 *
 * - `retry`   — reset ONE failed ticket (plus its failed blockers) to pending
 *               and start a burn. Continues from the ticket's preserved
 *               attempt commits; `fresh: true` discards them first.
 * - `stop`    — abort ONE burning ticket's agent, leaving the rest of the run
 *               alive. The ticket fails with its committed work preserved, so
 *               `retry` picks up where it stopped.
 * - `cancel`  — mark a pending/failed ticket cancelled (terminal; dependents
 *               treat it as satisfied). Same service the MCP tool uses.
 */
export const ticketRouter = router({
  retry: publicProcedure
    .input(z.object({ ticketId: z.string(), fresh: z.boolean().optional() }))
    .mutation(({ ctx, input }) => retryTicket(ctx, input.ticketId, { fresh: input.fresh })),

  stop: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(({ input }) => ({ stopped: stopTicketRun(input.ticketId) })),

  cancel: publicProcedure
    .input(z.object({ ticketId: z.string(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) => cancelTicket(ctx, input.ticketId, input.reason)),
})
