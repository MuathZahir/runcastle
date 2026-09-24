import type { ProjectNote } from '@runcastle/core'

/**
 * The project drive's derivations (project-level-test-drive decisions 4, 5, 7):
 * what the Test drive card offers, and how the notes rail splits the inbox
 * around the live drive. Pure — the card and the rail render what these say.
 */

/** The slice of `feature.driveInfo` these helpers read. */
export interface SlotHolder {
  projectDrive?: true
  projectId?: string
  /** Who holds the slot, in the server's words ("a project drive of main"). */
  holderLabel: string
}

/**
 * The Test drive card's state. `blocked` carries the reason the disabled button
 * states — the holding drive, named the way every other refusal names it.
 */
export type ProjectDriveCard =
  | { state: 'hidden' }
  | { state: 'prepare' }
  | { state: 'ready' }
  | { state: 'blocked'; reason: string }
  | { state: 'running' }

/** Is the drive in the one slot this project's own project drive? */
export function isThisProjectDrive(
  drive: SlotHolder | null | undefined,
  projectId: string,
): boolean {
  return Boolean(drive?.projectDrive && drive.projectId === projectId)
}

/**
 * What the card offers (decision 7). An empty project has nothing to drive, so
 * no card. A live drive of this project is the way back to it, whatever the
 * settings now say. With neither a setup nor a dev command a drive would do
 * literally nothing, so the button opens preparation instead of refusing. Any
 * other holder of the one slot blocks the start (decision 9).
 */
export function projectDriveCard({
  empty,
  setupCommand,
  devCommand,
  drive,
  projectId,
}: {
  empty: boolean
  setupCommand?: string | null
  devCommand?: string | null
  drive: SlotHolder | null | undefined
  projectId: string
}): ProjectDriveCard {
  if (empty) return { state: 'hidden' }
  if (isThisProjectDrive(drive, projectId)) return { state: 'running' }
  if (!setupCommand?.trim() && !devCommand?.trim()) return { state: 'prepare' }
  if (drive) return { state: 'blocked', reason: `${drive.holderLabel} is running` }
  return { state: 'ready' }
}

/**
 * The open notes, split around the live drive (decision 5): the ones taken since
 * it started first, then the ones that were already open, so a driver sees what
 * is already reported. Both newest first. There is no drive id — the start time
 * is the boundary — and with no drive everything is "already open".
 */
export function splitDriveNotes(
  notes: readonly ProjectNote[],
  startedAt: number | undefined,
): { thisDrive: ProjectNote[]; alreadyOpen: ProjectNote[] } {
  const open = notes.filter((n) => n.status === 'open').sort((a, b) => b.createdAt - a.createdAt)
  if (startedAt === undefined) return { thisDrive: [], alreadyOpen: open }
  return {
    thisDrive: open.filter((n) => n.createdAt >= startedAt),
    alreadyOpen: open.filter((n) => n.createdAt < startedAt),
  }
}

/**
 * The tag a note taken during a project drive wears: `drive · <branch>`, with
 * the commit it was seen on as its tooltip. `null` for every other note.
 */
export function driveTag(
  note: Pick<ProjectNote, 'driveBranch' | 'driveCommit'>,
): { label: string; title: string } | null {
  if (!note.driveBranch) return null
  return {
    label: `drive · ${note.driveBranch}`,
    title: note.driveCommit
      ? `noted while driving ${note.driveBranch} @ ${note.driveCommit}`
      : `noted while driving ${note.driveBranch}`,
  }
}
