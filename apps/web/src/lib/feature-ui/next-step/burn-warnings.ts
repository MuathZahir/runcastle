import { docsDigestSizeWarning, ticketShapeWarningLine, ticketShapeWarnings } from '@runcastle/core'
import type { ResolverInput } from './resolver-input'

/**
 * The one line both roads into a burn carry: what the batch is SHAPED like, and
 * what the burn is about to hand every ticket in it.
 *
 * Both halves are core's `ticket-shape.ts` wording, said where the human is
 * deciding rather than after the fact. The shapes were already here; the docs
 * digest was not — its size reached only the run timeline, appended to a
 * single-line row that clips, inside a panel that starts collapsed, which is to
 * say it reached nobody. It leads the line because it is the one cost every
 * ticket in the batch pays: the per-ticket shapes after it are spelled three
 * deep and then counted.
 *
 * A warning only, on both roads — the Burn button beside it is unchanged.
 */
export function burnWarningLine(input: ResolverInput): string | undefined {
  const digest = docsDigestSizeWarning(input.ctx.docsDigestBytes ?? 0)
  return ticketShapeWarningLine([
    ...(digest ? [digest] : []),
    ...ticketShapeWarnings(input.pendingTickets),
  ])
}
