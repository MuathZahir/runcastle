/** A line of command output that says what went wrong. */
const FAILURE_LINE =
  /permission denied|no space left|read-only file system|fatal:|error[:\s]|ERR!|cannot |could not|not found/i

/** Long enough for any real cause, short enough for a ticket row. */
const MAX_CAUSE_CHARS = 300

/**
 * The line of a failed command's output that names the cause: the last one that
 * reads like a failure, because tools report the root problem last and a long
 * install can print a harmless warning first. Otherwise the last line of output,
 * and undefined when the command said nothing at all.
 */
export function failureCause(output: readonly string[]): string | undefined {
  const lines = output.map((line) => line.trim()).filter(Boolean)
  const cause = lines.filter((line) => FAILURE_LINE.test(line)).at(-1) ?? lines.at(-1)
  return cause?.slice(0, MAX_CAUSE_CHARS)
}
