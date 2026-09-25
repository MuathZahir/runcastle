/**
 * A project conversation's title, as a list row should read it.
 *
 * The server titles a chat with the first thing typed into it, verbatim — which
 * is often not words: a pasted block arrives wrapped in `<pasted_content …>`, a
 * `/model` switch leaves `<local-command-stdout>` and ANSI colour codes behind,
 * and a pasted markdown note starts with `## ` or a `▎` quote bar. None of that
 * is what the human would call the chat, so the row drops it.
 *
 * Pure display: the stored title is untouched, and anything left empty — or the
 * server's own placeholder, "Untitled" — reads as "Untitled chat".
 */
export const UNTITLED_CHAT = 'Untitled chat'

// ANSI SGR sequences (`\u001b[1m`), written with the escape as a code point so
// the pattern carries no literal control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')
// Tag-shaped wrappers Claude Code puts around what it records: `<pasted_content
// id="…">`, `</local-command-stdout>`. Lowercase names only, so prose like
// "a < b" survives.
const WRAPPER_TAG = /<\/?[a-z][a-z0-9_-]*(?:\s[^<>]*)?>/g
// Leading markdown / terminal furniture: headings, quote bars, prompts, bullets,
// a stray full stop.
const LEADING_NOISE = /^(?:[#>▎❯•*\-.]+\s*)+/
const INLINE_NOISE = /[`▎]|\*\*/g

export function conversationTitle(raw: string | null | undefined): string {
  if (!raw) return UNTITLED_CHAT
  const cleaned = raw
    .replace(ANSI, '')
    .replace(WRAPPER_TAG, ' ')
    .replace(INLINE_NOISE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_NOISE, '')
    .trim()
  if (!cleaned || cleaned === '…' || /^untitled$/i.test(cleaned)) return UNTITLED_CHAT
  return cleaned
}

/** A status word in sentence case ("live" → "Live") — DESIGN.md: sentence case everywhere. */
export function sentenceCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * What one transcript turn should read as, for display. Claude Code records a
 * slash command as markup — `<command-name>/clear</command-name>`,
 * `<command-message>`, `<command-args>` — its output as
 * `<local-command-stdout>…`, and a `<local-command-caveat>` telling the model
 * to ignore both. None of that is prose a human typed, so a turn is one of:
 *
 * - `command` — the invocation, e.g. `/model opus` (rendered as a quiet mono line);
 * - `output` — what a local command printed, ANSI stripped (also quiet mono);
 * - `skip` — nothing worth a line (a caveat, an empty output);
 * - `text` — ordinary words, exactly as recorded.
 *
 * Pure display, like `conversationTitle`: the stored transcript is untouched.
 */
export type TurnDisplay =
  | { kind: 'command'; command: string }
  | { kind: 'output'; text: string }
  | { kind: 'skip' }
  | { kind: 'text'; text: string }

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const STDOUT = /^\s*<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>\s*$/
const CAVEAT = /^\s*<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*$/

export function turnDisplay(text: string): TurnDisplay {
  if (CAVEAT.test(text)) return { kind: 'skip' }
  const name = COMMAND_NAME.exec(text)
  if (name) {
    const command = name[1]!.trim()
    const args = COMMAND_ARGS.exec(text)?.[1]?.trim() ?? ''
    const shown = command.startsWith('/') ? command : `/${command}`
    return { kind: 'command', command: args ? `${shown} ${args}` : shown }
  }
  const out = STDOUT.exec(text)
  if (out) {
    const printed = out[1]!.replace(ANSI, '').trim()
    return printed ? { kind: 'output', text: printed } : { kind: 'skip' }
  }
  return { kind: 'text', text }
}
