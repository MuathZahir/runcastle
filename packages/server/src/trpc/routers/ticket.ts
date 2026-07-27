import * as z from 'zod'
import { retryTicket } from '../../services/features'
import { hasActiveRun } from '../../services/repo'
import { cancelTicket, getTicket, sweepOrphanedBurning } from '../../services/tickets'
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
 *               `retry` picks up where it stopped. With no agent AND no live
 *               run it instead sweeps the orphaned lane to `failed`, which is
 *               the same rescue and the only way out of that state from the UI.
 * - `cancel`  — mark a pending/failed ticket cancelled (terminal; dependents
 *               treat it as satisfied). Same service the MCP tool uses.
 */
export const ticketRouter = router({
  retry: publicProcedure
    .input(z.object({ ticketId: z.string(), fresh: z.boolean().optional() }))
    .mutation(({ ctx, input }) => retryTicket(ctx, input.ticketId, { fresh: input.fresh })),

  stop: publicProcedure.input(z.object({ ticketId: z.string() })).mutation(({ ctx, input }) => {
    if (stopTicketRun(input.ticketId)) return { stopped: true, swept: false }
    // No live agent HERE. If no run is live for the feature either, the ticket
    // is an orphan of a run that died mid-lane — sweep it to `failed` so retry
    // and cancel accept it again, instead of leaving the button as the only
    // affordance on a ticket nothing can move (`sweepOrphanedBurning`).
    const ticket = getTicket(ctx, input.ticketId)
    if (ticket.status === 'burning' && !hasActiveRun(ctx, ticket.featureId)) {
      sweepOrphanedBurning(ctx, ticket.featureId, 'orphaned — the run that was burning it is gone')
      return { stopped: false, swept: true }
    }
    return { stopped: false, swept: false }
  }),

  cancel: publicProcedure
    .input(z.object({ ticketId: z.string(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) => cancelTicket(ctx, input.ticketId, input.reason)),
})
