import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Feature, TestNoteStatus, Ticket, TicketInput } from '@runcastle/core'
import { TestNote, newId } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import { asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { testNotes } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { featureDocPath } from './feature-docs'
import { getFeatureRow, projectForFeature } from './repo'
import { getTicket, storeTickets } from './tickets'

/**
 * Test-drive notes. The human captures observations while a feature is in
 * review; each note is a row here, and `docs/features/<slug>/test-notes.md` is
 * a VIEW regenerated from the rows on every mutation — never appended to, never
 * parsed back. That file is the compatibility surface with the reader side (the
 * lap-session kickoff and the revisit skill already read its `## Lap N`
 * sections), which is why the render is idempotent and total.
 */

type TestNoteSelect = typeof testNotes.$inferSelect

function rowToNote(row: TestNoteSelect): TestNote {
  return TestNote.parse({
    id: row.id,
    featureId: row.featureId,
    lap: row.lap,
    text: row.text,
    status: row.status,
    ticketId: row.ticketId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function getNote(ctx: AppCtx, id: string): TestNote {
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

/**
 * Edit, delete and promote all need an `open` note: `done` must be untoggled
 * first, and `promoted` is frozen as the record of what its ticket was built
 * from (decisions.md #6).
 */
function assertOpen(note: TestNote, action: string): void {
  if (note.status !== 'open') {
    throw new InvalidInputError(
      `cannot ${action} note ${note.id} — it is ${note.status}; only open notes can be changed`,
    )
  }
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
 * Capture a note. Stamped with the feature's CURRENT lap (ADR-0010 / SPEC
 * §15.1) — the caller never chooses it, mirroring how `storeTickets` stamps
 * tickets — because the lap is what groups the rendered file.
 */
export function addNote(ctx: AppCtx, featureId: string, text: string): TestNote {
  const body = cleanText(text)
  const feature = getFeatureRow(ctx, featureId)
  const now = Date.now()

  const row = ctx.db
    .insert(testNotes)
    .values({
      id: newId('note'),
      featureId,
      lap: feature.lap,
      text: body,
      status: 'open' as const,
      ticketId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  const note = rowToNote(row)
  emit(ctx, featureId, {
    type: 'note.added',
    message: `note captured on lap ${note.lap}`,
    data: { noteId: note.id, lap: note.lap },
  })
  renderTestNotes(ctx, feature)
  return note
}

/** Fix a typo in an open note — `test-notes.md` is what the next lap reads. */
export function editNote(ctx: AppCtx, noteId: string, text: string): TestNote {
  const current = getNote(ctx, noteId)
  assertOpen(current, 'edit')
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
  renderTestNotes(ctx, getFeatureRow(ctx, current.featureId))
  return getNote(ctx, noteId)
}

/** Drop a dead observation. Only open notes — a promoted one has a ticket. */
export function deleteNote(ctx: AppCtx, noteId: string): void {
  const current = getNote(ctx, noteId)
  assertOpen(current, 'delete')

  ctx.db.delete(testNotes).where(eq(testNotes.id, noteId)).run()

  emit(ctx, current.featureId, {
    type: 'note.deleted',
    message: 'note deleted',
    data: { noteId },
  })
  renderTestNotes(ctx, getFeatureRow(ctx, current.featureId))
}

/**
 * Scratch a note off (or put it back) — `done` means "handled or dismissed"
 * with no enforcement, so it toggles both ways. `promoted` is frozen.
 */
export function toggleNote(ctx: AppCtx, noteId: string): TestNote {
  const current = getNote(ctx, noteId)
  if (current.status === 'promoted') {
    throw new InvalidInputError(
      `cannot toggle note ${noteId} — it is promoted, and promoted notes are frozen`,
    )
  }
  const status: TestNoteStatus = current.status === 'open' ? 'done' : 'open'

  ctx.db
    .update(testNotes)
    .set({ status, updatedAt: Date.now() })
    .where(eq(testNotes.id, noteId))
    .run()

  emit(ctx, current.featureId, {
    type: 'note.toggled',
    message: `note ${current.status} → ${status}`,
    data: { noteId, from: current.status, to: status },
  })
  renderTestNotes(ctx, getFeatureRow(ctx, current.featureId))
  return getNote(ctx, noteId)
}

/** Longest a derived ticket title runs before it is elided. */
const TITLE_MAX = 60

/**
 * The mechanical promotion template (decisions.md #5): the note IS the spec of
 * the defect, so the ticket is assembled from it rather than drafted by an
 * agent. Thickness comes from provenance and doc pointers, not from prose.
 */
function promotionTicket(feature: Feature, note: TestNote): TicketInput {
  const firstLine = note.text.split('\n')[0].trim()
  const docs = featureDocsRel(feature.slug)
  return {
    title:
      firstLine.length <= TITLE_MAX
        ? firstLine
        : `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…`,
    goal: note.text,
    context: [
      `Found during lap ${note.lap} test drive of ${feature.slug}.`,
      `Read ${docs}/spec.md and ${docs}/decisions.md for what this feature is meant to do.`,
    ].join('\n\n'),
    acceptanceCriteria: [`The noted behavior no longer reproduces: ${note.text}`],
    seams: [],
    blockedBy: [],
  }
}

/**
 * Turn an open note into a `pending` fix ticket on the current lap, in one
 * click. The ticket goes through `storeTickets` so seq/lap/status semantics
 * stay in one place, and the existing Burn-from-review path picks it up
 * unchanged; the note then freezes with a link to it.
 */
export function promoteNote(
  ctx: AppCtx,
  noteId: string,
): { note: TestNote; ticket: Ticket } {
  const current = getNote(ctx, noteId)
  assertOpen(current, 'promote')
  const feature = getFeatureRow(ctx, current.featureId)

  const [ticket] = storeTickets(ctx, current.featureId, [promotionTicket(feature, current)])

  ctx.db
    .update(testNotes)
    .set({ status: 'promoted', ticketId: ticket.id, updatedAt: Date.now() })
    .where(eq(testNotes.id, noteId))
    .run()

  emit(ctx, current.featureId, {
    type: 'note.promoted',
    message: `note promoted to ticket ${ticket.seq}`,
    ticketId: ticket.id,
    data: { noteId, seq: ticket.seq },
  })
  renderTestNotes(ctx, feature)
  return { note: getNote(ctx, noteId), ticket }
}

function noteLine(ctx: AppCtx, note: TestNote): string {
  if (note.status === 'open') return `- [ ] ${note.text}`
  // A promoted note always carries its ticket; done notes never do.
  const ticket = note.ticketId ? ` (→ ticket ${getTicket(ctx, note.ticketId).seq})` : ''
  return `- [x] ${note.text}${ticket}`
}

/**
 * Regenerate `docs/features/<slug>/test-notes.md` from the full row set. The
 * format — `## Lap N` sections ascending, one checkbox line per note in capture
 * order — is what the lap-session kickoff and the revisit skill already expect
 * to read, so it is a contract, not a presentation choice.
 */
function renderTestNotes(ctx: AppCtx, feature: Feature): void {
  const notes = listByFeature(ctx, feature.id)
  const laps = [...new Set(notes.map((n) => n.lap))].sort((a, b) => a - b)

  const lines = ['# Test notes']
  for (const lap of laps) {
    lines.push('', `## Lap ${lap}`, '')
    for (const note of notes.filter((n) => n.lap === lap)) lines.push(noteLine(ctx, note))
  }

  const path = featureDocPath(projectForFeature(ctx, feature), feature, 'test-notes.md')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}
