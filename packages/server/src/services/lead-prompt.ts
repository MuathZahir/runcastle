/**
 * How a prompt runcastle delivers to a feature chat is told apart from one the
 * human typed (`the-feature-lead-runs-rounds` spec, "Stopping": only human
 * messages count for the after-Stop dispatch check).
 *
 * Every prompt runcastle puts into a feature chat — a wake, a kickoff, Go — opens
 * with {@link RUNCASTLE_PROMPT_TAG} (terminal-era transcripts also carry it
 * inside the retired message waiter's hook-feedback wrapper); the
 * `UserPromptSubmit` hook marks a human message only for a prompt that does
 * neither. Pure, so the launcher, the delivery and the hook route can all share
 * it without an import cycle.
 */

/** The leading marker on every prompt runcastle delivers. */
export const RUNCASTLE_PROMPT_TAG = '[runcastle]'

/** `text` with the marker in front, once. */
export function tagRuncastlePrompt(text: string): string {
  return isRuncastlePrompt(text) ? text : `${RUNCASTLE_PROMPT_TAG} ${text}`
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
