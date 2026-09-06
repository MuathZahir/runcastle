import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Feature,
  TestNoteAuthor,
  TestNoteStatus,
  Ticket,
  TicketInput,
} from '@runcastle/core'
import { TestNote, fmtClock, newId, noteScreenshotUrl, ticketTitleFromNote } from '@runcastle/core'
import {
  annotationPath,
  annotationsDir,
  attachmentRelPath,
  featureDocsRel,
} from '@runcastle/core/paths'
import { and, asc, eq, lt } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { testNotes, tickets } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { featureDocPath } from './feature-docs'
import { getFeatureRow, projectForFeature } from './repo'
import { getTicket, storeTickets } from './tickets'
import { assertIterable } from './features'
import { promoteOpenDefects, viewByFeature } from './review-findings'

/**
 * Test-drive notes. The human captures observations while a feature is in
 * review; each note is a row here, and `docs/features/<slug>/test-notes.md` is
 * a VIEW regenerated from the rows on every mutation — never appended to, never
 * parsed back. That file is the compatibility surface with the reader side (the
 * lap-session kickoff and the revisit skill already read its `## Lap N`
 * sections), which is why the render is idempotent and total.
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
    lap: row.lap,
    text: row.text,
    status: row.status,
    author: row.author,
    ticketId: row.ticketId ?? undefined,
    reviewTicketId: row.reviewTicketId ?? undefined,
    carriedLap: row.carriedLap ?? undefined,
    videoTimestamp: row.videoTimestamp ?? undefined,
    screenshotUrl: existsSync(annotationPath(row.id)) ? noteScreenshotUrl(row.id) : undefined,
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
 *
 * `author` is the one thing the caller does choose: the review panel leaves it
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
  const feature = getFeatureRow(ctx, featureId)
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
      lap: feature.lap,
      text: body,
      status: 'open' as const,
      author,
      ticketId: null,
      videoTimestamp: videoTimestamp ?? null,
      reviewTicketId: reviewTicketId ?? null,
      carriedLap: null,
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
        ? `review agent captured a note on lap ${note.lap}`
        : `note captured on lap ${note.lap}`,
    data: { noteId: note.id, lap: note.lap, author: note.author },
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

/**
 * Drop a dead observation. Only open notes — a promoted one has a ticket.
 *
 * The note's annotated frame goes with it: this is the one delete path, so it is
 * the one cleanup hook (decisions.md #7). `force` swallows the absence, which is
 * the common case — most notes were never annotated.
 */
export function deleteNote(ctx: AppCtx, noteId: string): void {
  const current = getNote(ctx, noteId)
  assertOpen(current, 'delete')

  ctx.db.delete(testNotes).where(eq(testNotes.id, noteId)).run()
  rmSync(annotationPath(noteId), { force: true })

  emit(ctx, current.featureId, {
    type: 'note.deleted',
    message: 'note deleted',
    data: { noteId },
  })
  renderTestNotes(ctx, getFeatureRow(ctx, current.featureId))
}

/**
 * Attach the annotated frame the human drew on: the PNG the player composited
 * from the paused video frame plus the strokes, stored at
 * `~/.runcastle/annotations/<noteId>.png`.
 *
 * Writing the file is the whole mutation — there is no row to update — but it
 * still emits and re-renders like any other note change, because the thumbnail
 * the notes list shows and the `(screenshot: …)` line in `test-notes.md` both
 * only appear once this file exists.
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
  renderTestNotes(ctx, getFeatureRow(ctx, note.featureId))
  return getNote(ctx, noteId)
}

/**
 * Scratch a note off (or put it back) — `done` means "handled or dismissed"
 * with no enforcement, so it toggles both ways. `promoted` is frozen.
 */
export function toggleNote(ctx: AppCtx, noteId: string): TestNote {
  const current = getNote(ctx, noteId)
  if (current.status === 'promoted' || current.status === 'carried') {
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

/**
 * The paragraph that carries an annotated note's screenshot into the burn
 * (spec.md "Riding into the burn"). It names the WORKSPACE-relative path the
 * burner copies the PNG to and tells the agent to Read it — the ticket payload
 * has no attachment field, so this sentence is the entire contract, and
 * `attachmentRelPath` is what keeps both ends spelling it the same way.
 *
 * Written only when the PNG was on disk when the note was read — every note
 * reaching here came through {@link rowToNote}, which is where that stat
 * happens. The reverse case (a PNG deleted between promotion and burn) is left
 * to degrade on its own: the agent's Read fails and it proceeds on the note
 * text, which is exactly what an unannotated note gives it.
 */
function screenshotParagraph(note: TestNote): string | undefined {
  if (!note.screenshotUrl) return undefined
  const moment =
    note.videoTimestamp === undefined
      ? ''
      : `, captured at ${fmtClock(note.videoTimestamp)} of the review walkthrough`
  return `An annotated screenshot of the problem is at ${attachmentRelPath(note.id)} in your workspace${moment} — Read it before starting; the drawing marks the problem area.`
}

/**
 * The mechanical promotion template (decisions.md #5): the note IS the spec of
 * the defect, so the ticket is assembled from it rather than drafted by an
 * agent. Thickness comes from provenance and doc pointers, not from prose.
 */
function promotionTicket(feature: Feature, note: TestNote): TicketInput {
  const docs = featureDocsRel(feature.slug)
  const screenshot = screenshotParagraph(note)
  return {
    title: ticketTitleFromNote(note.text),
    goal: note.text,
    context: [
      `Found during lap ${note.lap} test drive of ${feature.slug}.`,
      `Read ${docs}/spec.md and ${docs}/decisions.md for what this feature is meant to do.`,
      ...(screenshot ? [screenshot] : []),
    ].join('\n\n'),
    acceptanceCriteria: [`The noted behavior no longer reproduces: ${note.text}`],
    seams: [],
    blockedBy: [],
  }
}

/**
 * Turn open notes into `pending` fix tickets on the current lap — the body both
 * promoters share. Every guard runs before the first write, so a selection with
 * one bad note mints no tickets at all: the panel's checkboxes are the human's
 * whole triage decision, and a half-applied one would leave them re-deriving
 * which half landed.
 *
 * The tickets go through `storeTickets` in the selection's own order, so
 * seq/lap/status semantics stay in one place and the existing Burn-from-review
 * path picks them up unchanged; the notes then freeze with a link each.
 *
 * The event and the `test-notes.md` re-render are the CALLERS' — one promotion
 * reads as one line in the timeline whether it moved one note or six.
 */
function freezeAsTickets(
  ctx: AppCtx,
  noteIds: string[],
): { feature: Feature; notes: TestNote[]; tickets: Ticket[] } {
  // The scheduler appends the verification pass after this fix-only burn drains (decision 40a).
  if (noteIds.length === 0) throw new InvalidInputError('no notes selected to promote')
  if (new Set(noteIds).size !== noteIds.length)
    throw new InvalidInputError('the same note appears twice in the selection')

  const selected = noteIds.map((id) => getNote(ctx, id))
  for (const note of selected) assertOpen(note, 'promote')

  const featureId = selected[0].featureId
  if (selected.some((n) => n.featureId !== featureId))
    throw new InvalidInputError('every note in a promotion must belong to the same feature')
  const feature = getFeatureRow(ctx, featureId)

  const tickets = storeTickets(
    ctx,
    featureId,
    selected.map((note) => promotionTicket(feature, note)),
  )

  const now = Date.now()
  selected.forEach((note, i) => {
    ctx.db
      .update(testNotes)
      .set({ status: 'promoted', ticketId: tickets[i].id, updatedAt: now })
      .where(eq(testNotes.id, note.id))
      .run()
  })

  return { feature, notes: selected.map((n) => getNote(ctx, n.id)), tickets }
}

/**
 * Promote ONE note, in one click. Kept for the MCP wire and for callers that
 * want the minted ticket back on its own; the review panel batches instead.
 */
export function promoteNote(
  ctx: AppCtx,
  noteId: string,
): { note: TestNote; ticket: Ticket } {
  const { feature, notes, tickets } = freezeAsTickets(ctx, [noteId])
  const [note] = notes
  const [ticket] = tickets

  emit(ctx, feature.id, {
    type: 'note.promoted',
    message: `note promoted to ticket ${ticket.seq}`,
    ticketId: ticket.id,
    data: { noteId, seq: ticket.seq },
  })
  renderTestNotes(ctx, feature)
  return { note, ticket }
}

/**
 * Promote a SELECTION of notes in one mutation (decisions.md #11). Triage is one
 * decision the human makes over the whole findings inbox — "these are quick
 * fixes" — so it lands as one call, one timeline entry and one re-render, rather
 * than the per-note promotion that made them click through their own triage.
 */
export function promoteMany(
  ctx: AppCtx,
  noteIds: string[],
): { notes: TestNote[]; tickets: Ticket[] } {
  const { feature, notes, tickets } = freezeAsTickets(ctx, noteIds)

  emit(ctx, feature.id, {
    type: 'notes.promoted',
    message: `${notes.length} note${notes.length === 1 ? '' : 's'} promoted to ticket${
      tickets.length === 1 ? ` ${tickets[0].seq}` : `s ${tickets.map((t) => t.seq).join(', ')}`
    }`,
    data: { noteIds, seqs: tickets.map((t) => t.seq) },
  })
  renderTestNotes(ctx, feature)
  return { notes, tickets }
}

/**
 * The absolute path suffix an annotated note's line carries, so a host-side
 * session reading `test-notes.md` can Read the image itself (decisions.md #5).
 * Absolute because the reader's working directory is the target repo, and the
 * annotations dir is not under it.
 */
function screenshotSuffix(note: TestNote): string {
  return note.screenshotUrl ? ` (screenshot: ${annotationPath(note.id)})` : ''
}

function noteLine(ctx: AppCtx, note: TestNote): string {
  const shot = screenshotSuffix(note)
  if (note.status === 'open') return `- [ ] ${note.text}${shot}`
  if (note.status === 'carried') return `- [→] ${note.text} (carried into lap ${note.carriedLap})${shot}`
  // A promoted note always carries its ticket; done notes never do.
  const ticket = note.ticketId ? ` (→ ticket ${getTicket(ctx, note.ticketId).seq})` : ''
  return `- [x] ${note.text}${ticket}${shot}`
}

export function carryNotes(ctx: AppCtx, featureId: string, noteIds: string[], lap: number): TestNote[] {
  const selected = noteIds.map((id) => getNote(ctx, id))
  for (const note of selected) {
    if (note.featureId !== featureId) throw new InvalidInputError('every carried note must belong to the feature')
    assertOpen(note, 'carry')
    ctx.db.update(testNotes).set({ status: 'carried', carriedLap: lap, updatedAt: Date.now() }).where(eq(testNotes.id, note.id)).run()
    emit(ctx, featureId, { type: 'note.carried', message: `note carried into lap ${lap}`, data: { noteId: note.id, lap } })
  }
  renderTestNotes(ctx, getFeatureRow(ctx, featureId))
  return selected.map((note) => getNote(ctx, note.id))
}

export function reopenNote(ctx: AppCtx, noteId: string): TestNote {
  const note = getNote(ctx, noteId)
  if (note.status !== 'carried') throw new InvalidInputError('only a carried note can be reopened')
  ctx.db.update(testNotes).set({ status: 'open', carriedLap: null, updatedAt: Date.now() }).where(eq(testNotes.id, noteId)).run()
  emit(ctx, note.featureId, { type: 'note.reopened', message: 'note reopened', data: { noteId } })
  renderTestNotes(ctx, getFeatureRow(ctx, note.featureId))
  return getNote(ctx, noteId)
}

export interface TriageInput { quickFixIds: string[]; quickFixFindingIds: string[]; dismissIds: string[]; carry: boolean }

/** Commit triage only; the caller subsequently invokes feature.burn or feature.rethink. */
export function triageNotes(ctx: AppCtx, featureId: string, input: TriageInput): { minted: number; carried: number; dismissed: number } {
  const feature = getFeatureRow(ctx, featureId)
  assertIterable(ctx, feature)
  for (const id of input.dismissIds) deleteNote(ctx, id)
  const noteTickets = input.quickFixIds.length ? freezeAsTickets(ctx, input.quickFixIds).tickets.length : 0
  const findingTickets = input.quickFixFindingIds.length ? promoteOpenDefects(ctx, featureId, input.quickFixFindingIds).tickets.length : 0
  // No review ticket is appended here: queue-drain verification owns that invariant.
  const remaining = input.carry ? listByFeature(ctx, featureId).filter((note) => note.status === 'open') : []
  if (remaining.length) carryNotes(ctx, featureId, remaining.map((note) => note.id), feature.lap + 1)
  return { minted: noteTickets + findingTickets, carried: remaining.length, dismissed: input.dismissIds.length }
}

export function triagePreview(ctx: AppCtx, featureId: string) {
  const feature = getFeatureRow(ctx, featureId)
  const standing = ctx.db.select().from(tickets).where(and(eq(tickets.featureId, featureId), eq(tickets.kind, 'implementation'), eq(tickets.status, 'pending'), lt(tickets.lap, feature.lap))).all()
  const grouped = new Map<number, number>()
  for (const ticket of standing) grouped.set(ticket.lap, (grouped.get(ticket.lap) ?? 0) + 1)
  return {
    openNotes: listByFeature(ctx, featureId).filter((note) => note.status === 'open').length,
    openDefects: viewByFeature(ctx, featureId).openDefects.length,
    standingFixTickets: [...grouped].sort(([a], [b]) => a - b).map(([lap, count]) => ({ count, lap })),
  }
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
