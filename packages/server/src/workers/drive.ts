import { type DriveWorkerKind, type SessionKind, type SessionRow, type WorkerRow, isDriveWorkerKind } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { isHostReview } from './review'

/**
 * Drive workers (docs/features/drive-chats-become-workers): the Fix-drive chat
 * and the scenario chat docked beside a test drive, as workers of kind
 * `fix-drive` and `scenario`. They run on the host, in the human's checkout the
 * drive switched to (decision 1), under the drive chats' guards (decision 9);
 * only the human starts or talks to one (decision 6), and nothing of theirs
 * waits to land (decision 3).
 */

/** Why the lead's land, send back, drop and message tools refuse a drive worker (decisions 3, 6). */
export const DRIVE_WORKER_REFUSAL = 'a drive worker commits straight onto the driven branch and only the human talks to it'

/**
 * A worker that runs on the host, with no sandbox, branch or preview: a drive
 * review (burns-become-workers decision 3), or a drive worker (decision 1).
 */
export function isHostWorker(w: Pick<WorkerRow, 'kind' | 'reviewMode'>): boolean {
  return isHostReview(w) || isDriveWorkerKind(w.kind)
}

/** The drive worker a `worker` session is the conversation of, if it is one. */
export function driveWorkerOf(ctx: AppCtx, session: Pick<SessionRow, 'id' | 'kind'> | undefined): (WorkerRow & { kind: DriveWorkerKind }) | undefined {
  if (session?.kind !== 'worker') return undefined
  const w = ctx.db.select().from(workers).where(eq(workers.id, session.id)).get()
  return w && isDriveWorkerKind(w.kind) ? { ...w, kind: w.kind } : undefined
}

/**
 * The kind the edit, install and checkout guards judge a session as (decision
 * 9): a drive worker's conversation is guarded exactly as the drive chat it
 * replaces (`fix-drive` as `drive-fix`, `scenario` as `scenario`); every other
 * session as its own kind. The session's `purpose` still says `scenario-setup`.
 */
export function guardKindOf(ctx: AppCtx, session: Pick<SessionRow, 'id' | 'kind'>): SessionKind {
  const w = driveWorkerOf(ctx, session)
  if (!w) return session.kind
  return w.kind === 'fix-drive' ? 'drive-fix' : 'scenario'
}

/**
 * A drive worker's briefing on the host. A stand-in until the drive buttons
 * start drive workers (this feature's ticket 2), which brief them from the
 * drive's state as today's drive chats are.
 */
export function driveWorkerBriefing(w: Pick<WorkerRow, 'label'>): string {
  return [
    `# You are a runcastle worker: ${w.label}`,
    '',
    "The human started you beside their test drive. You run on the human's own machine, in the project's checkout, on the branch the drive holds.",
    '',
    '- When the human is done with what they asked, call hand_back with a short summary, then end your turn.',
  ].join('\n')
}
