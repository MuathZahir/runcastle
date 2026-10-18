/**
 * How a prompt runcastle delivers to a feature chat is told apart from one the
 * human typed (`the-feature-lead-runs-rounds` spec, "Stopping": only human
 * messages count for the Ask-mode dispatch check).
 *
 * Every prompt runcastle puts into a feature chat — a wake, a kickoff, Go — opens
 * with {@link RUNCASTLE_PROMPT_TAG}; the `UserPromptSubmit` hook marks a human
 * message only for a prompt that does not. Pure, so the launcher, the delivery
 * and the hook route can all share it without an import cycle.
 */

import type { AgentRuntime } from '@runcastle/core'
import { skillRef } from '../launcher/runtimes/skills'

/** The leading marker on every prompt runcastle delivers. */
export const RUNCASTLE_PROMPT_TAG = '[runcastle]'

/** `text` with the marker in front, once. */
export function tagRuncastlePrompt(text: string): string {
  return isRuncastlePrompt(text) ? text : `${RUNCASTLE_PROMPT_TAG} ${text}`
}

/**
 * The opening of a `lead-wake` run's prompt: the lead's pending messages, said
 * to come by a headless run because no terminal of it was open, so it acts on
 * them in this run instead of waiting for a reply nobody is there to give.
 * `resumed` says whether the run continues the feature's conversation; when no
 * conversation of it was on record the run is a fresh one, and says so rather
 * than claiming context it does not have.
 */
export function leadWakeKickoff(message: string, resumed: boolean): string {
  const how = resumed
    ? 'No terminal of yours was open, so runcastle resumed this conversation headless'
    : 'No terminal of yours was open and no earlier conversation of this feature could be ' +
      'resumed, so runcastle started this conversation headless from the feature docs'
  return (
    `${RUNCASTLE_PROMPT_TAG} ${how} to deliver what follows. Nobody is watching this run: act on it ` +
    'as the lead — fix, dispatch a round, declare ready, or call wait_for_you to ask the ' +
    `human — then end your turn.\n\n${message}\n\n`
  )
}

/**
 * The wake Go sends the feature's chat. A chat that was live through planning
 * opened on `ideate` or `revisit` and never saw the lead brief (only a launch
 * past Go renders it), so this names the lead skill the way the fresh-launch
 * kickoff does — spelled for the chat's `runtime`.
 */
export function goWakeText(runtime: AgentRuntime): string {
  return (
    `Go given — the human approved the plan. You are now this feature's lead: invoke ` +
    `${skillRef(runtime, 'lead')} first, then dispatch round 1 with dispatch_round({ seqs }), ` +
    'or do it yourself if it is small.'
  )
}

/** Whether a submitted prompt is one runcastle delivered. */
export function isRuncastlePrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(RUNCASTLE_PROMPT_TAG)
}
