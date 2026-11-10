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

/**
 * The tags Claude Code wraps a prompt it makes itself in (triage-batch decision
 * 18), read off the 2.1.x bundle: a finished background command, subagent,
 * remote task or Monitor event (`task-notification`), and messages from other
 * agents, sessions or channels. None is the human typing.
 */
const MACHINE_PROMPT_TAGS = [
  'task-notification',
  'teammate-message',
  'cross-session-message',
  'agent-message',
  'coordinator-relay',
  'channel',
  'remote-review',
  'remote-review-progress',
  'slack-ping',
  'slack-tag-message',
] as const

const MACHINE_PROMPT = new RegExp(`^<(?:${MACHINE_PROMPT_TAGS.join('|')})(?=[\\s>])`)

/**
 * Whether a submitted prompt is one Claude Code made on its own: a background
 * helper's result, a peer's message. The lead's prompt hook skips it, as it
 * skips the compaction command: it moves no feature and clears no wait.
 */
export function isMachinePrompt(prompt: string): boolean {
  return MACHINE_PROMPT.test(prompt.trimStart())
}

/** How an opening held for the human's first message ends: that message follows it, in the same prompt. */
export const HELD_OPENING_END = "The human's message follows."

/**
 * The words the human typed under a held opening (every-feature-has-one-owner
 * decision 23): a chat nobody started opens on their first message, which rides
 * in one prompt behind runcastle's tagged opening. Null when the prompt holds no
 * such opening, or when what follows it is runcastle's own (a relay, a wake).
 */
export function typedAfterOpening(prompt: string): string | null {
  const at = prompt.indexOf(HELD_OPENING_END)
  if (at < 0 || !isRuncastlePrompt(prompt)) return null
  const rest = prompt.slice(at + HELD_OPENING_END.length).trim()
  return rest && !isRuncastlePrompt(rest) ? rest : null
}

/** A runcastle prompt's own lines: the hook feedback's wrapper around them, if any, taken off. */
export function runcastleLines(prompt: string): string {
  const text = prompt.trim()
  if (!HOOK_FEEDBACK_LINE.test(text)) return text
  return text
    .slice(text.indexOf(RUNCASTLE_PROMPT_TAG))
    .replace(/\s*<\/system-reminder>$/, '')
}
