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

/** The leading marker on every prompt runcastle delivers. */
export const RUNCASTLE_PROMPT_TAG = '[runcastle]'

/** `text` with the marker in front, once. */
export function tagRuncastlePrompt(text: string): string {
  return isRuncastlePrompt(text) ? text : `${RUNCASTLE_PROMPT_TAG} ${text}`
}

/**
 * The opening of a `lead-wake` run's prompt: the lead's pending messages, said
 * to come by a headless resume because no terminal of it was open, so it acts
 * on them in this run instead of waiting for a reply nobody is there to give.
 */
export function leadWakeKickoff(message: string): string {
  return (
    `${RUNCASTLE_PROMPT_TAG} No terminal of yours was open, so runcastle resumed this ` +
    'conversation headless to deliver what follows. Nobody is watching this run: act on it ' +
    'as the lead — fix, dispatch a round, declare ready, or call wait_for_you to ask the ' +
    `human — then end your turn.\n\n${message}\n\n`
  )
}

/** Whether a submitted prompt is one runcastle delivered. */
export function isRuncastlePrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(RUNCASTLE_PROMPT_TAG)
}
