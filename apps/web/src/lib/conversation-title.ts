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
