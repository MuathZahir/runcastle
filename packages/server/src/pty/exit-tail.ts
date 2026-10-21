import { stripVTControlCharacters } from 'node:util'

/** How much of a failed process's output `session.pty_exited` carries. */
const EXIT_TAIL_LINES = 20
const EXIT_TAIL_CHARS = 2000

/**
 * The last lines a process printed, as text: control sequences stripped, blank
 * lines dropped, at most {@link EXIT_TAIL_LINES} lines and
 * {@link EXIT_TAIL_CHARS} characters — the newest kept when it is cut.
 */
export function exitTail(output: Buffer): string {
  const lines = stripVTControlCharacters(output.toString('utf8'))
    .split(/\r?\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
  return lines.slice(-EXIT_TAIL_LINES).join('\n').slice(-EXIT_TAIL_CHARS)
}
