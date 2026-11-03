import type { TestNote } from '@runcastle/core'

/**
 * The notes "Send to agent" would carry: the human's own, not yet sent — the
 * server's `notes.send` takes exactly these.
 */
export function unsentNotes(notes: readonly TestNote[]): TestNote[] {
  return notes.filter((n) => n.author === 'human' && n.sentAt === undefined)
}

/**
 * Stop the drive, then send (small-fixes-before-publish decisions 8, 15): the
 * lead never wakes into a drive that holds its rounds, and the notes go even
 * when the stop fails — that failure shows the way a failed Stop does, from the
 * stop itself.
 */
export function stopThenSend(stop: () => Promise<unknown>, send: () => void): void {
  void stop()
    .catch(() => undefined)
    .then(send)
}

/** Said while a drive of this feature runs (`the-feature-lead-runs-rounds` decision 19). */
export const DRIVE_HOLDS_THE_AGENT =
  'While this drive runs, the agent can’t start a round or land its own edits.'
