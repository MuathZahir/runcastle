/**
 * How a prompt runcastle delivers to a feature chat is told apart from one the
 * human typed (`the-feature-lead-runs-rounds` spec, "Stopping": only human
 * messages count for the after-Stop dispatch check).
 *
 * Every prompt runcastle puts into a feature chat — a wake, a kickoff, Go — opens
 * with {@link RUNCASTLE_PROMPT_TAG}, or carries it inside the live waiter's
 * hook-feedback wrapper; the `UserPromptSubmit` hook marks a human message only
 * for a prompt that does neither. Pure, so the launcher, the delivery
 * and the hook route can all share it without an import cycle.
 */

import type { AgentRuntime } from '@runcastle/core'
import { FEATURE_SKILL, skillRef } from '../launcher/runtimes/skills'

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
export function leadWakeKickoff(runtime: AgentRuntime, message: string, resumed: boolean): string {
  const how = resumed
    ? 'No terminal of yours was open, so runcastle resumed this conversation headless'
    : 'No terminal of yours was open and no earlier conversation of this feature could be ' +
      'resumed, so runcastle started this conversation headless from the feature docs'
  return (
    `${RUNCASTLE_PROMPT_TAG} ${how} to deliver what follows. Nobody is watching this run: act on it ` +
    `as the lead, by ${skillRef(runtime, FEATURE_SKILL)} — fix, dispatch a round, declare ready, or ` +
    `call wait_for_you to ask the human — then end your turn.\n\n${message}\n\n`
  )
}

/**
 * A line the live waiter hands back: Claude Code's asyncRewake delivers a hook's
 * output wrapped as hook feedback — `<task-notification>…</task-notification>
 * <system-reminder>Stop hook blocking error from command "Stop": [runcastle] …`
 * — so the tag sits after the hook's own preamble, not at the prompt's start.
 */
const HOOK_FEEDBACK_LINE = /^<task-notification>[\s\S]*hook blocking error from command "[^"]*":\s*\[runcastle\]/i

/**
 * Whether a submitted prompt is one runcastle delivered: it opens with the tag,
 * or it is the waiter's hook feedback carrying a tagged line. Every line the
 * waiter delivers is tagged ({@link tagRuncastlePrompt}), the human's included —
 * those were marked when they were queued, so they are not counted twice.
 */
export function isRuncastlePrompt(prompt: string): boolean {
  const text = prompt.trimStart()
  return text.startsWith(RUNCASTLE_PROMPT_TAG) || HOOK_FEEDBACK_LINE.test(text)
}
