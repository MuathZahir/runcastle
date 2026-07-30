/**
 * Plain-language definitions for runcastle's insider words (findings F16).
 *
 * Grill, burn, gate and lap all appear at the moment the human is deciding
 * whether to click something, and a newcomer meets them there for the first
 * time — so the definition belongs beside the action, not in a glossary nobody
 * opens. Keeping the sentences here means every surface says the same thing.
 */

/** New-feature form: what the session it offers to open actually is. */
export const GRILL_EXPLAINER =
  'A grill session is a Q&A conversation with Claude to pin the idea down before any code is written.'

/**
 * Tickets + build bodies: the mechanics behind Burn, which the bar's "review,
 * then burn" never says (finding F12) — where the work runs and where it lands.
 */
export const BURN_EXPLAINER =
  'Burning runs each ticket as its own sandboxed agent, in parallel, committing to the feature branch.'

/** Inspector gate rail: why the pipeline is sitting still. */
export const GATE_EXPLAINER =
  'Gates are the human approval points — runcastle stops at one and waits for you.'

/** First-run wizard, on the step that configures them. */
export const AFK_BURN_EXPLAINER =
  'An AFK burn is a burn you walk away from: runcastle runs the tickets in containers, unattended, and you read the result when you are back.'

/**
 * Laps, wherever the number shows. The pipeline chip only appears past lap 1 (a
 * lap-1 feature looks like the plain linear flow, ADR-0010 §4) so it can name
 * what put it there; the forms that print "lap 1" get the plainer half.
 */
export function lapExplainer(lap: number): string {
  if (lap <= 1)
    return 'Lap 1 — this feature’s first pass through the pipeline. Iterate, from review, opens the next one.'
  return (
    `Lap ${lap} — Iterate sent this feature back through the pipeline for another pass. ` +
    `Earlier laps’ docs, tickets and commits are all kept.`
  )
}
