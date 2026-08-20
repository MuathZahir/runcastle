/**
 * Formatting shared across the wire's two ends. Presentation normally belongs
 * to the web app alone — this is here because both ends render the SAME fact
 * and a human compares them: the moment in a walkthrough a note was captured at
 * is shown by the player, by the note's thumbnail, and in the promoted ticket's
 * context paragraph that a fix agent reads.
 */

/**
 * A player position as a clock: `0:07`, `2:31`, `1:04:12`. Seconds in, not
 * epochs — this reads a `<video>`'s `currentTime`, which is why a duration the
 * element does not know yet (`Infinity`, `NaN`) has to render as unknown rather
 * than as a number.
 *
 * Hours are shown only when there are any, and minutes zero-pad only once an
 * hours field precedes them — so a short walkthrough reads `2:31` rather than
 * `0:02:31`.
 */
export function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
