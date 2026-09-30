import { z } from 'zod'

/**
 * The server's own run of a project's verify commands against the feature
 * branch under review (gates-mode-review decisions #1-#3). Stored per review
 * pass on the review ticket, so the review page shows what actually ran, on
 * which commit — never the agent's prose about it.
 */

/** `couldnt_run` = the command timed out or could not start. */
export const GateCommandOutcome = z.enum(['passed', 'failed', 'couldnt_run'])
export type GateCommandOutcome = z.infer<typeof GateCommandOutcome>

export const GateCommandResult = z.object({
  command: z.string(),
  outcome: GateCommandOutcome,
  exitCode: z.number().nullable(),
  reason: z.string().optional(),
  /** File name inside the review's gate-log dir, e.g. `0.log`. */
  log: z.string(),
})
export type GateCommandResult = z.infer<typeof GateCommandResult>

export const ReviewGateRun = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none_configured') }),
  /** Sandbox unavailable, install failed…; `log` is e.g. `run.log`. */
  z.object({
    status: z.literal('couldnt_run'),
    commit: z.string(),
    reason: z.string(),
    log: z.string().nullable(),
  }),
  z.object({
    status: z.literal('ran'),
    commit: z.string(),
    commands: z.array(GateCommandResult),
  }),
])
export type ReviewGateRun = z.infer<typeof ReviewGateRun>
