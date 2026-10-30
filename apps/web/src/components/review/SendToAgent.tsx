import type { TestNote } from '@runcastle/core'

/**
 * The notes "Send to agent" would carry: the human's own, not yet sent, and not
 * frozen into a ticket — the server's `notes.send` takes exactly these.
 */
export function unsentNotes(notes: readonly TestNote[]): TestNote[] {
  return notes.filter((n) => n.author === 'human' && n.sentAt === undefined && n.status !== 'promoted')
}

/** Said while a drive of this feature runs (`the-feature-lead-runs-rounds` decision 19). */
export const DRIVE_HOLDS_THE_AGENT =
  'While this drive runs, the agent can’t start a round or land its own edits.'
