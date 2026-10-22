import { stripVTControlCharacters } from 'node:util'

/** How much of a failed process's output `session.pty_exited` carries. */
const EXIT_TAIL_LINES = 20
const EXIT_TAIL_CHARS = 2000

/**
 * An OSC sequence (a console's window title, a hyperlink), up to its BEL or ST
 * terminator. Stripped first: `stripVTControlCharacters` only knows OSC bodies
 * without a backslash, so a Windows title (`ESC]0;C:\WINDOWS\…`) loses only its
 * head and leaves the path in the text.
 */
// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** Control characters left after the sequences are gone: a stray BEL, backspace… */
// eslint-disable-next-line no-control-regex
const STRAY_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * The lines with every run of consecutive identical blocks kept once: ConPTY
 * repaints the whole screen, so a block printed once can arrive twice.
 */
function collapseRepeats(lines: string[]): string[] {
  const kept: string[] = []
  for (const line of lines) {
    kept.push(line)
    for (let size = Math.floor(kept.length / 2); size >= 1; size--) {
      const at = kept.length - size
      if (kept.slice(at).every((l, i) => l === kept[at - size + i])) {
        kept.length = at
        break
      }
    }
  }
  return kept
}

/**
 * The last lines a process printed, as text: control sequences stripped, blank
 * lines dropped, repainted blocks kept once, at most {@link EXIT_TAIL_LINES}
 * lines and {@link EXIT_TAIL_CHARS} characters — the newest kept when it is cut.
 */
export function exitTail(output: Buffer): string {
  const text = stripVTControlCharacters(output.toString('utf8').replace(OSC, '')).replace(STRAY_CONTROL, '')
  const lines = text
    .split(/\r?\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
  return collapseRepeats(lines).slice(-EXIT_TAIL_LINES).join('\n').slice(-EXIT_TAIL_CHARS)
}
