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
 * PASTE — stock xterm maps Ctrl+V to `^V` and then calls `preventDefault()`,
 * which suppresses the browser's own `paste` event; the clipboard never reaches
 * the PTY and a stray `^V` byte does. We swallow Ctrl+V instead: xterm skips its
 * handling and, because the interception path never cancels the event, the
 * browser pastes natively into xterm's hidden textarea, where xterm's `paste`
 * listener picks it up and sends it bracketed. Alt+V is Claude Code's image
 * paste and must arrive as ESC+v, which xterm only produces off macOS — see
 * IMAGE_PASTE_BYTES.
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
  /** Physical key position — the only reliable read of Alt+V on macOS. */
  code: string
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
 * ESC + v — Alt+V, the Claude TUI's "paste the image on the clipboard". xterm
 * emits this itself on Windows/Linux but not on macOS, where Option is a
 * third-level shift by default and Option+V composes the character `√` instead.
 * Sending it ourselves makes the shortcut behave the same on every platform.
 */
export const IMAGE_PASTE_BYTES = '\x1bv'

/**
 * Is this the physical `V` key? macOS composes Option+V into `√` before the
 * event is dispatched, so `key` alone misses Alt+V there; `code` still reports
 * the key that was pressed.
 */
function isVKey(ev: TerminalKeyEvent): boolean {
  return ev.key === 'v' || ev.key === 'V' || ev.code === 'KeyV'
}

/**
 * Map a terminal keyboard event to a send/passthrough decision.
 *
 * Shift+Enter and Ctrl+Enter become a prompt newline; Ctrl+V is swallowed so the
 * browser's own paste runs, and Alt+V becomes ESC+v for Claude Code's image
 * paste. Everything else — plain Enter, Cmd+V and Ctrl+Shift+V included — passes
 * through so ordinary typing, submit, Ctrl+C and arrows/history keep xterm's
 * native behavior. (Alt+Enter needs no handling here: xterm already ESC-prefixes
 * it into the same `\x1b\r`.)
 */
export function mapTerminalKey(ev: TerminalKeyEvent): TerminalKeyAction {
  // Only keydown carries the bytes; the matching keypress is swallowed empty.
  const down = ev.type === 'keydown'
  if (!down && ev.type !== 'keypress') return { intercept: false }

  if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey)) {
    return { intercept: true, bytes: down ? NEWLINE_BYTES : '' }
  }

  if (isVKey(ev) && !ev.shiftKey && !ev.metaKey) {
    // Ctrl+V — send nothing at all; the browser's paste event does the work.
    if (ev.ctrlKey && !ev.altKey) return { intercept: true, bytes: '' }
    // Alt+V — Ctrl+Alt is AltGr on Windows, an ordinary character, so exclude it.
    if (ev.altKey && !ev.ctrlKey) return { intercept: true, bytes: down ? IMAGE_PASTE_BYTES : '' }
  }

  return { intercept: false }
}
