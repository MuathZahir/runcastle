/**
 * Plain-language definitions for runcastle's insider words (findings F16).
 *
 * Grill, burn, gate and lap all appear at the moment the human is deciding
 * whether to click something, and a newcomer meets them there for the first
 * time — so the definition belongs beside the action, not in a glossary nobody
 * opens. Keeping the sentences here means every surface says the same thing.
 */

import { DEFAULT_RUNTIME } from '@runcastle/core'
import type { AgentRuntime } from '@runcastle/core'
import type { DriveCapabilities } from './settings'

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

/** New-feature form: what the session it offers to open actually is. */
export const GRILL_EXPLAINER =
  'A grill session is a Q&A conversation with the agent to pin the idea down before any code is written.'

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

/** Inspector gate rail: why the pipeline is sitting still. */
export const GATE_EXPLAINER =
  'Gates are the human approval points — runcastle stops at one and waits for you.'

/** First-run wizard, on the step that configures them. */
export const AFK_BURN_EXPLAINER =
  'An AFK burn is a burn you walk away from: runcastle runs the tickets in containers, unattended, and you read the result when you are back.'

/**
 * Test drive, on the review page — the word whose meaning depends on the
 * project. An unprepared project gets a branch checkout and nothing else; a
 * prepared one gets its setup command run and its dev server booted, which is
 * where "each branch gets its own database" comes from.
 * A single sentence covering both would have to hedge, so the caller passes the
 * capabilities it read from settings and the sentence names only what will
 * really happen. `undefined` (settings still loading) gets the shared half
 * alone: true on every project, and promising nothing this one cannot do.
 */
export function testDriveExplainer(caps: DriveCapabilities | undefined): string {
  const checkout =
    'A test drive checks out this feature’s branch in your working repo so you can click through the change yourself'
  if (!caps) return `${checkout}.`

  const restore = caps.teardown
    ? ' Stopping runs the teardown command and puts you back on the branch you were on.'
    : ' Stopping puts you back on the branch you were on.'

  // Named in the order the drive performs them. No step carries a comma of its
  // own — three of these joined into one sentence read as a list or not at all.
  const steps = [
    caps.setup && 'runs the test-drive setup command',
    caps.dev && 'starts the dev server with an Open app link',
  ].filter((s): s is string => typeof s === 'string')

  if (steps.length === 0)
    return (
      `${checkout} — this project has no test-drive commands set, so the checkout is all it does. ` +
      `Preparation is where you teach it to bring the app up too.${restore}`
    )
  return `${checkout}, then ${joinSteps(steps)}.${restore}`
}

/** "a", "a and b", "a, b and c" — read aloud, not comma-spliced. */
function joinSteps(steps: string[]): string {
  const last = steps[steps.length - 1] ?? ''
  if (steps.length === 1) return last
  return `${steps.slice(0, -1).join(', ')} and ${last}`
}

/**
 * Laps, wherever the number shows. The pipeline chip only appears past lap 1 (a
 * lap-1 feature looks like the plain linear flow, ADR-0010 §4) so it can name
 * what put it there; the forms that print "lap 1" get the plainer half.
 */
/**
 * The lap banner's middle line — what put the feature on the lap it is on
 * (decisions.md #6). A constant, not a lookup: Iterate is the ONLY thing that
 * bumps a lap, so the reason is always this, and the feed is left to supply the
 * one thing that does vary — when.
 */
export const LAP_KICKOFF =
  'Iterate sent this feature back through the pipeline: the lap session read your test-drive ' +
  'notes, amended the spec, and emitted this lap’s tickets. Earlier laps are kept in full.'

export function lapExplainer(lap: number): string {
  if (lap <= 1)
    return 'Lap 1 — this feature’s first pass through the pipeline. Iterate, from review, opens the next one.'
  return (
    `Lap ${lap} — Iterate sent this feature back through the pipeline for another pass. ` +
    `Earlier laps’ docs, tickets and commits are all kept.`
  )
}
