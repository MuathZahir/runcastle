import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { ProjectNote } from '@runcastle/core'
import { newId, ProjectNote as ProjectNoteSchema, projectNoteScreenshotUrl } from '@runcastle/core'
import { projectNotePath, projectNotesDir } from '@runcastle/core/paths'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features, projectNotes } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emitProject } from './events'
import { activeProjectDriveStamp } from './git'
import { requireProjectById } from './repo'

type ProjectNoteSelect = typeof projectNotes.$inferSelect

function rowToNote(row: ProjectNoteSelect): ProjectNote {
  return ProjectNoteSchema.parse({
    ...row,
    outcome: row.outcome ?? undefined,
    featureId: row.featureId ?? undefined,
    driveBranch: row.driveBranch ?? undefined,
    driveCommit: row.driveCommit ?? undefined,
    screenshotUrl: existsSync(projectNotePath(row.id))
      ? projectNoteScreenshotUrl(row.id)
      : undefined,
  })
}

function clean(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new InvalidInputError(`${label} cannot be empty`)
  return trimmed
}

export function getNote(ctx: AppCtx, noteId: string): ProjectNote {
  const row = ctx.db.select().from(projectNotes).where(eq(projectNotes.id, noteId)).get()
  if (!row) throw new NotFoundError(`project note ${noteId} not found`)
  return rowToNote(row)
}

function requireOpen(note: ProjectNote, action: string): void {
  if (note.status !== 'open')
    throw new InvalidInputError(`cannot ${action} project note ${note.id} — it is triaged`)
}

export function addNote(ctx: AppCtx, projectId: string, text: string): ProjectNote {
  requireProjectById(ctx, projectId)
  const now = Date.now()
  // Every door a note comes through lands here, so a note taken during this
  // project's drive is stamped with what it was seen on without any client
  // passing it (project-level-test-drive decision 5).
  const stamp = activeProjectDriveStamp(projectId)
  const row = ctx.db.insert(projectNotes).values({
    id: newId('pnote'), projectId, text: clean(text, 'note text'), status: 'open',
    outcome: null, featureId: null, driveBranch: stamp?.driveBranch ?? null,
    driveCommit: stamp?.driveCommit ?? null, createdAt: now, updatedAt: now,
  }).returning().get()
  const note = rowToNote(row)
  emitProject(ctx, projectId, { type: 'project_note.added', message: 'project note captured', data: { noteId: note.id } })
  return note
}

export function listNotes(ctx: AppCtx, projectId: string): ProjectNote[] {
  return ctx.db.select().from(projectNotes).where(eq(projectNotes.projectId, projectId))
    .orderBy(desc(projectNotes.createdAt), desc(projectNotes.id)).all().map(rowToNote)
    .sort((a, b) => Number(a.status === 'triaged') - Number(b.status === 'triaged'))
}

export function openCount(ctx: AppCtx, projectId: string): number {
  return ctx.db.select({ value: count() }).from(projectNotes)
    .where(and(eq(projectNotes.projectId, projectId), eq(projectNotes.status, 'open'))).get()?.value ?? 0
}

export function editNote(ctx: AppCtx, noteId: string, text: string): ProjectNote {
  const note = getNote(ctx, noteId)
  requireOpen(note, 'edit')
  ctx.db.update(projectNotes).set({ text: clean(text, 'note text'), updatedAt: Date.now() })
    .where(eq(projectNotes.id, noteId)).run()
  emitProject(ctx, note.projectId, { type: 'project_note.edited', message: 'project note edited', data: { noteId } })
  return getNote(ctx, noteId)
}

export function deleteNote(ctx: AppCtx, noteId: string): void {
  const note = getNote(ctx, noteId)
  requireOpen(note, 'delete')
  ctx.db.delete(projectNotes).where(eq(projectNotes.id, noteId)).run()
  rmSync(projectNotePath(noteId), { force: true })
  emitProject(ctx, note.projectId, { type: 'project_note.deleted', message: 'project note deleted', data: { noteId } })
}

function triage(ctx: AppCtx, noteIds: string[], outcome: string, featureId?: string, verb = 'triaged'): ProjectNote[] {
  if (!noteIds.length) throw new InvalidInputError('no project notes selected')
  if (new Set(noteIds).size !== noteIds.length) throw new InvalidInputError('the same project note appears twice')
  const result = clean(outcome, 'triage outcome')
  const notes = noteIds.map((id) => getNote(ctx, id))
  for (const note of notes) requireOpen(note, 'triage')
  const projectId = notes[0].projectId
  if (notes.some((note) => note.projectId !== projectId))
    throw new InvalidInputError('every project note in a triage must belong to the same project')
  if (featureId) {
    const feature = ctx.db.select({ projectId: features.projectId }).from(features)
      .where(eq(features.id, featureId)).get()
    if (!feature) throw new NotFoundError(`feature ${featureId} not found`)
    if (feature.projectId !== projectId)
      throw new InvalidInputError('triage feature must belong to the same project as the notes')
  }
  ctx.db.update(projectNotes).set({ status: 'triaged', outcome: result, featureId: featureId ?? null, updatedAt: Date.now() })
    .where(inArray(projectNotes.id, noteIds)).run()
  emitProject(ctx, projectId, { type: `project_note.${verb}`, message: `${notes.length} project note${notes.length === 1 ? '' : 's'} ${verb}`, data: { noteIds, outcome: result, featureId } })
  return noteIds.map((id) => getNote(ctx, id))
}

export function triageNotes(ctx: AppCtx, noteIds: string[], outcome: string, featureId?: string): ProjectNote[] {
  return triage(ctx, noteIds, outcome, featureId)
}

export function dismissNote(ctx: AppCtx, noteId: string): ProjectNote {
  return triage(ctx, [noteId], 'dismissed', undefined, 'dismissed')[0]
}

export function reopenNote(ctx: AppCtx, noteId: string): ProjectNote {
  const note = getNote(ctx, noteId)
  if (note.status !== 'triaged') throw new InvalidInputError(`cannot reopen project note ${noteId} — it is open`)
  ctx.db.update(projectNotes).set({ status: 'open', outcome: null, featureId: null, updatedAt: Date.now() })
    .where(eq(projectNotes.id, noteId)).run()
  emitProject(ctx, note.projectId, { type: 'project_note.reopened', message: 'project note reopened', data: { noteId } })
  return getNote(ctx, noteId)
}

export function attachScreenshot(ctx: AppCtx, noteId: string, png: Uint8Array): ProjectNote {
  const note = getNote(ctx, noteId)
  mkdirSync(projectNotesDir(), { recursive: true })
  writeFileSync(projectNotePath(note.id), png)
  emitProject(ctx, note.projectId, { type: 'project_note.screenshot', message: 'screenshot attached to project note', data: { noteId } })
  return getNote(ctx, noteId)
}
