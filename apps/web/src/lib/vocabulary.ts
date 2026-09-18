/**
 * Plain-language definitions for runcastle's insider words (findings F16).
 *
 * Burn, waypoint, gate and lap all appear at the moment the human is deciding
 * whether to click something, and a newcomer meets them there for the first
 * time — so the definition belongs beside the action, not in a glossary nobody
 * opens. Keeping the sentences here means every surface says the same thing.
 *
 * A word only earns an entry if it survives the copy policy (decision 12).
 * "Grill" did not: the buttons say `Start session` now and the phase is already
 * named ideation, so the explainer that glossed it went with the word.
 */

import { DEFAULT_RUNTIME } from '@runcastle/core'
import type { AgentRuntime } from '@runcastle/core'

/**
 * What to call the thing on the other side of a session (decision 11).
 *
 * Distinct from `RUNTIME_LABEL`, which names the *product* in a settings
 * dropdown ("Claude Code"); this names the *correspondent* in a sentence, which
 * is the shorter word — you shape an idea with Claude, not with Claude Code.
 *
 * `undefined` is the case that matters most: copy about a session that has not
 * been launched, or about work that has not picked a model, cannot know the
 * runtime and must not guess one — a Codex-only human reading "Claude" is the
 * broken product decision 11 exists to prevent.
 */
const AGENT_NAME: Record<AgentRuntime, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
}

export function agentName(runtime: AgentRuntime | null | undefined): string {
  return runtime ? AGENT_NAME[runtime] : 'the agent'
}

/**
 * {@link agentName} for a session that EXISTS — which is a different question,
 * because a session row always ran on something. A row written before the
 * `runtime` column reads as {@link DEFAULT_RUNTIME} (the db schema's stated
 * convention, and what the server applies when it reads one back), so an old
 * conversation is named rather than anonymised.
 */
export function sessionAgentName(session: { runtime?: AgentRuntime | null }): string {
  return agentName(session.runtime ?? DEFAULT_RUNTIME)
}

export const WAYPOINT_EXPLAINER =
  'A map breaks a big idea into waypoints — questions each worked in its own session. The feature converges once every waypoint is done.'

/**
 * Tickets + build bodies: the mechanics behind Burn, which the bar's "review,
 * then burn" never says (finding F12) — where the work runs and where it lands.
 */
export const BURN_EXPLAINER =
  'Burning runs each ticket as its own sandboxed agent, in parallel, committing to the feature branch.'

/**
 * Status bar, on the notify toggle. "Notify me when a burn finishes" met a
 * newcomer with an unexplained verb at the moment of a click (decision 9): the
 * chrome may *name* a burn, but a sentence about one has to read without the
 * word.
 */
export const NOTIFY_OFFER = 'Notify me when agents finish a run'

/**
 * Stop ticket and Cancel run, when the kill could not be confirmed. Both wait
 * for the agent's process to be observed dead, so a mutation that resolves
 * normally means it IS dead — this sentence is for the one case where the server
 * could not prove it, and it is said in the same words wherever a stop is
 * offered.
 */
export const STOP_TIMEOUT = 'stop timed out — the process may still be running'

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
