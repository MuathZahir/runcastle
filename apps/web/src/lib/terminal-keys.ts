/**
 * Pure key mapping for the embedded terminal (streamlining-ux, ticket 4).
 *
 * Stock xterm emits a bare `\r` for Enter regardless of modifiers, so the Claude
 * TUI submits the prompt even on Shift+Enter / Ctrl+Enter. This module maps a
 * keyboard event to the bytes the terminal should send instead, so
 * `TerminalView` can intercept modifier+Enter and insert a newline in the
 * prompt rather than submit.
 *
 * Kept free of any xterm dependency so it is unit-testable in isolation; the
 * event shape is the minimal subset of `KeyboardEvent` the mapping reads.
 *
 * NEWLINE SEQUENCE — verified empirically against the Claude TUI (v2.1.218) in a
 * real PTY: `\x1b\r` (ESC + CR, the sequence Claude Code's own `/terminal-setup`
 * binds for Shift+Enter) inserts a newline in the prompt WITHOUT submitting,
 * whereas a bare `\r` submits. Sent as a single write so the ESC and CR reach
 * the TUI together (a lone ESC followed later by a lone CR reads as submit).
 *
 * DOUBLE-FIRE — xterm's custom key handler runs on both `keydown` and `keypress`
 * (see `_keyDown`/`_keyPress` in @xterm/xterm). We carry the bytes on `keydown`
 * and swallow the matching `keypress` (empty bytes, no send) so xterm's own
 * Enter handling never also emits a bare `\r`. `keyup` and every non-target key
 * pass straight through to xterm untouched.
 */

/** Minimal subset of `KeyboardEvent` the mapping reads. */
export interface TerminalKeyEvent {
  type: string
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * `intercept: true` — xterm must NOT process this event; send `bytes` to the PTY
 * yourself (an empty `bytes` means "swallow, send nothing").
 * `intercept: false` — let xterm handle the event normally.
 */
export type TerminalKeyAction = { intercept: true; bytes: string } | { intercept: false }

/** ESC + CR — the sequence the Claude TUI accepts as newline-without-submit. */
export const NEWLINE_BYTES = '\x1b\r'

/**
 * Map a terminal keyboard event to a send/passthrough decision. Shift+Enter and
 * Ctrl+Enter become a prompt newline; everything else — plain Enter included —
 * passes through so ordinary typing, submit, Ctrl+C, arrows/history and paste
 * keep xterm's native behavior. (Alt+Enter needs no handling here: xterm already
 * ESC-prefixes it into the same `\x1b\r`.)
 */
export function mapTerminalKey(ev: TerminalKeyEvent): TerminalKeyAction {
  if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey)) {
    if (ev.type === 'keydown') return { intercept: true, bytes: NEWLINE_BYTES }
    if (ev.type === 'keypress') return { intercept: true, bytes: '' }
  }
  return { intercept: false }
}
