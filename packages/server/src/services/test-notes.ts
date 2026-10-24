import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { TestNoteAuthor } from '@runcastle/core'
import { TestNote, newId, noteScreenshotUrl } from '@runcastle/core'
import { annotationPath, annotationsDir } from '@runcastle/core/paths'
import { asc, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { testNotes } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { deliverToLead, leadDeliveryState } from './lead-delivery'
import { getFeatureRow } from './repo'
import { getTicket } from './tickets'

/**
 * Test-drive notes. The human jots observations while driving a feature; each
 * note is a row here, and Send to agent delivers the unsent ones to the
 * feature's agent as one chat message. Nothing files them anywhere else.
 */

type TestNoteSelect = typeof testNotes.$inferSelect

/**
 * The row plus the one fact that is not in it: whether this note's annotated
 * frame is on disk (decisions.md #5). Every read path funnels through here, so
 * a screenshot written or deleted is reflected the moment the next read runs —
 * there is no row to keep in sync.
 *
 * This stat is the ONLY place the question "does this note have a screenshot?"
 * is answered; everything downstream reads the stamped `screenshotUrl` instead
 * of asking the disk again. The URL itself comes from core, which is also where
 * the route that serves it gets its pattern.
 */
function rowToNote(row: TestNoteSelect): TestNote {
  return TestNote.parse({
    id: row.id,
    featureId: row.featureId,
    text: row.text,
    status: row.status,
    author: row.author,
    ticketId: row.ticketId ?? undefined,
    reviewTicketId: row.reviewTicketId ?? undefined,
    videoTimestamp: row.videoTimestamp ?? undefined,
    screenshotUrl: existsSync(annotationPath(row.id)) ? noteScreenshotUrl(row.id) : undefined,
    sentAt: row.sentAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function getNote(ctx: AppCtx, id: string): TestNote {
  const row = ctx.db.select().from(testNotes).where(eq(testNotes.id, id)).get()
  if (!row) throw new NotFoundError(`test note ${id} not found`)
  return rowToNote(row)
}

/** Note text as it is stored: trimmed, and never empty. */
function cleanText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new InvalidInputError('note text cannot be empty')
  return trimmed
}

export function listByFeature(ctx: AppCtx, featureId: string): TestNote[] {
  return ctx.db
    .select()
    .from(testNotes)
    .where(eq(testNotes.featureId, featureId))
    .orderBy(asc(testNotes.createdAt), asc(testNotes.id))
    .all()
    .map(rowToNote)
}

/**
 * Capture a note on an existing feature.
 *
 * `author` is the one thing the caller chooses: the review panel leaves it
 * at `human`, and the `add_test_note` MCP wire passes `agent` so a review
 * ticket's findings arrive attributed. Nothing else about the note differs.
 *
 * `videoTimestamp` arrives only from the annotation player — the moment in the
 * walkthrough the human paused on. The screenshot that usually accompanies it is
 * a separate upload ({@link attachScreenshot}), because it travels as PNG bytes
 * rather than as JSON.
 */
export function addNote(
  ctx: AppCtx,
  featureId: string,
  text: string,
  author: TestNoteAuthor = 'human',
  videoTimestamp?: number,
  reviewTicketId?: string,
): TestNote {
  const body = cleanText(text)
  getFeatureRow(ctx, featureId)
  if (reviewTicketId) {
    const ticket = getTicket(ctx, reviewTicketId)
    if (ticket.featureId !== featureId || ticket.kind !== 'review')
      throw new InvalidInputError('review ticket must be a review of the same feature')
  }
  const now = Date.now()

  const row = ctx.db
    .insert(testNotes)
    .values({
      id: newId('note'),
      featureId,
      text: body,
      status: 'open' as const,
      author,
      ticketId: null,
      videoTimestamp: videoTimestamp ?? null,
      reviewTicketId: reviewTicketId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  const note = rowToNote(row)
  emit(ctx, featureId, {
    type: 'note.added',
    message:
      note.author === 'agent'
        ? 'review agent captured a note'
        : 'note captured',
    data: { noteId: note.id, author: note.author },
  })
  return note
}

/** Fix a typo in a note. */
export function editNote(ctx: AppCtx, noteId: string, text: string): TestNote {
  const current = getNote(ctx, noteId)
  const body = cleanText(text)

  ctx.db
    .update(testNotes)
    .set({ text: body, updatedAt: Date.now() })
    .where(eq(testNotes.id, noteId))
    .run()

  emit(ctx, current.featureId, {
    type: 'note.edited',
    message: 'note edited',
    data: { noteId },
  })
  return getNote(ctx, noteId)
}

/**
 * Drop a dead observation. A sent note can be deleted too.
 *
 * The note's annotated frame goes with it: this is the one delete path, so it is
 * the one cleanup hook (decisions.md #7). `force` swallows the absence, which is
 * the common case — most notes were never annotated.
 */
export function deleteNote(ctx: AppCtx, noteId: string): void {
  const current = getNote(ctx, noteId)

  ctx.db.delete(testNotes).where(eq(testNotes.id, noteId)).run()
  rmSync(annotationPath(noteId), { force: true })

  emit(ctx, current.featureId, {
    type: 'note.deleted',
    message: 'note deleted',
    data: { noteId },
  })
}

/**
 * Attach the annotated frame the human drew on: the PNG the player composited
 * from the paused video frame plus the strokes, stored at
 * `~/.runcastle/annotations/<noteId>.png`.
 *
 * Writing the file is the whole mutation — there is no row to update — but it
 * still emits like any other note change, because the thumbnail the notes list
 * shows and the screenshot path Send to agent carries both only appear once
 * this file exists.
 *
 * Re-uploading overwrites: one screenshot per note is locked (decisions.md #3),
 * so a second capture for the same note replaces the first.
 */
export function attachScreenshot(ctx: AppCtx, noteId: string, png: Uint8Array): TestNote {
  const note = getNote(ctx, noteId)

  mkdirSync(annotationsDir(), { recursive: true })
  writeFileSync(annotationPath(noteId), png)

  emit(ctx, note.featureId, {
    type: 'note.screenshot',
    message: 'annotated frame attached to note',
    data: { noteId },
  })
  return getNote(ctx, noteId)
}

/**
 * Send to agent (`the-feature-lead-runs-rounds` decision 18): every human note
 * not yet sent — screenshots as absolute paths the lead can read — goes to the
 * feature's lead as ONE human message, so it acts on a considered batch rather
 * than a note at a time. Sending with no notes is a message too: the drive went
 * fine. Usable any time, and again later: only the unsent ones travel.
 * `waiting` says the message is queued for an agent that has not taken it yet.
 */
export async function sendNotes(ctx: AppCtx, featureId: string): Promise<{ sent: number; waiting: boolean }> {
  const feature = getFeatureRow(ctx, featureId)
  const unsent = listByFeature(ctx, featureId).filter(
    (note) => note.author === 'human' && note.sentAt === undefined,
  )
  const text =
    unsent.length === 0
      ? '[Drive notes from the human] Drive done, all good — no notes.'
      : [
          `[Drive notes from the human] ${unsent.length} note${unsent.length === 1 ? '' : 's'} from the drive:`,
          ...unsent.map(
            (note, i) =>
              `${i + 1}. ${note.text}${note.screenshotUrl ? ` (screenshot: ${annotationPath(note.id)})` : ''}`,
          ),
        ].join('\n')
  await deliverToLead(ctx, feature, { text, source: 'human' })

  const now = Date.now()
  if (unsent.length > 0) {
    ctx.db
      .update(testNotes)
      .set({ sentAt: now })
      .where(inArray(testNotes.id, unsent.map((note) => note.id)))
      .run()
  }
  emit(ctx, featureId, {
    type: 'notes.sent',
    message: unsent.length === 0 ? 'drive done, all good — sent to the agent' : `${unsent.length} note(s) sent to the agent`,
    data: { noteIds: unsent.map((note) => note.id), at: now },
  })
  // No agent took it yet when none is open: it is queued for the next wake (decision 28).
  return { sent: unsent.length, waiting: leadDeliveryState(featureId).waitingSince !== null }
}

