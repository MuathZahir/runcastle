import * as z from 'zod'
import { emit } from '../../services/events'
import { retryTicket } from '../../services/features'
import { hasActiveRun } from '../../services/repo'
import {
  cancelTicket,
  editTicket,
  getTicket,
  sweepOrphanedBurning,
  ticketDurationStats,
} from '../../services/tickets'
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
 * - `stop`    — kill ONE burning ticket's agent, leaving the rest of the run
 *               alive, and resolve only once it is confirmed dead (`confirmed`
 *               says whether that was observed or the deadline ran out). The
 *               ticket fails with its committed work preserved, so `retry` picks
 *               up where it stopped. With no agent AND no live run it instead
 *               sweeps the orphaned lane to `failed`, which is the same rescue
 *               and the only way out of that state from the UI.
 * - `cancel`  — mark a pending/failed ticket cancelled (terminal; dependents
 *               treat it as satisfied). Same service the MCP tool uses.
 * - `edit`    — rewrite a pending/failed ticket's content, or reassign the model
 *               it burns on, from the UI. The
 *               same `editTicket` service the MCP `update_ticket` tool calls,
 *               exposed on the wire because the quick-change door (decision 21)
 *               promises a card the human can correct before Burn *without*
 *               opening a terminal to do it.
 *
 * Plus one read: `durationStats`, the project's own ticket history, which is
 * what lets the pre-burn bar say how long a burn has been taking here instead
 * of quoting a number someone hardcoded (decisions.md #16b).
 */
export const ticketRouter = router({
  retry: publicProcedure
    .input(z.object({ ticketId: z.string(), fresh: z.boolean().optional() }))
    .mutation(({ ctx, input }) => retryTicket(ctx, input.ticketId, { fresh: input.fresh })),

  stop: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Resolves only once the agent's process is confirmed dead — so the UI's
      // pending state IS "stopping…", and what it settles into is the truth.
      const { stopped, confirmed } = await stopTicketRun(input.ticketId)
      if (stopped) {
        // The kill ran out its deadline with the process still there. Nothing
        // else in the stack would ever say so, and this is exactly the state the
        // old silent "stopped" was hiding — put it on the timeline as well as in
        // the response, so it survives the toast being dismissed.
        if (!confirmed) {
          const ticket = getTicket(ctx, input.ticketId)
          emit(ctx, ticket.featureId, {
            type: 'ticket.stop_timeout',
            message: `ticket #${ticket.seq}: stop timed out — the process may still be running`,
            ticketId: ticket.id,
          })
        }
        return { stopped: true, swept: false, confirmed }
      }
      // No live agent HERE. If no run is live for the feature either, the ticket
      // is an orphan of a run that died mid-lane — sweep it to `failed` so retry
      // and cancel accept it again, instead of leaving the button as the only
      // affordance on a ticket nothing can move (`sweepOrphanedBurning`).
      const ticket = getTicket(ctx, input.ticketId)
      if (ticket.status === 'burning' && !hasActiveRun(ctx, ticket.featureId)) {
        sweepOrphanedBurning(ctx, ticket.featureId, 'orphaned — the run that was burning it is gone')
        return { stopped: false, swept: true, confirmed }
      }
      return { stopped: false, swept: false, confirmed }
    }),

  cancel: publicProcedure
    .input(z.object({ ticketId: z.string(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) => cancelTicket(ctx, input.ticketId, input.reason)),

  durationStats: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => ticketDurationStats(ctx, input.projectId)),

  edit: publicProcedure
    .input(
      z.object({
        ticketId: z.string(),
        title: z.string().min(1).optional(),
        goal: z.string().min(1).optional(),
        context: z.string().optional(),
        acceptanceCriteria: z.array(z.string().min(1)).optional(),
        // The burn-model assignment (decisions.md #4). Empty clears it, which is
        // how the card's "default" option puts the ticket back on the ordinary
        // chain; the service refuses any id off the configured roster.
        model: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { ticketId, ...patch } = input
      return editTicket(ctx, ticketId, patch)
    }),
})
