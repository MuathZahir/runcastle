import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectNotePath } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listByProject } from '../src/services/events'
import {
  addNote, attachScreenshot, deleteNote, dismissNote, editNote, listNotes,
  openCount, reopenNote, triageNotes,
} from '../src/services/project-notes'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('project notes service', () => {
  let ctx: AppCtx
  let projectId: string
  let temp: string
  let restore: () => void

  beforeEach(async () => {
    temp = mkdtempSync(join(tmpdir(), 'project-notes-'))
    restore = useDataDir(temp)
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01'))
  })
  afterEach(() => { vi.useRealTimers(); restore(); rmSync(temp, { recursive: true, force: true }) })

  it('adds trimmed pnote ids, orders open newest first, and counts only open', () => {
    const first = addNote(ctx, projectId, ' first ')
    vi.advanceTimersByTime(1)
    const second = addNote(ctx, projectId, 'second')
    triageNotes(ctx, [first.id], 'handled')
    expect(second.id).toMatch(/^pnote_/)
    expect(listNotes(ctx, projectId).map((note) => note.id)).toEqual([second.id, first.id])
    expect(openCount(ctx, projectId)).toBe(1)
    expect(() => addNote(ctx, projectId, '  ')).toThrow(InvalidInputError)
  })

  it('edits and deletes only open notes, deleting their screenshot', () => {
    const note = addNote(ctx, projectId, 'old')
    attachScreenshot(ctx, note.id, new Uint8Array([1, 2]))
    expect(editNote(ctx, note.id, 'new').text).toBe('new')
    deleteNote(ctx, note.id)
    expect(existsSync(projectNotePath(note.id))).toBe(false)
    const frozen = addNote(ctx, projectId, 'frozen')
    triageNotes(ctx, [frozen.id], 'done')
    expect(() => editNote(ctx, frozen.id, 'no')).toThrow(/triaged/)
    expect(() => deleteNote(ctx, frozen.id)).toThrow(/triaged/)
  })

  it('triages atomically, validates feature ownership, dismisses and reopens', () => {
    const one = addNote(ctx, projectId, 'one')
    const two = addNote(ctx, projectId, 'two')
    const feature = seedFeature(ctx, projectId)
    expect(triageNotes(ctx, [one.id, two.id], '→ feature', feature.id).map((n) => n.status))
      .toEqual(['triaged', 'triaged'])
    expect(() => triageNotes(ctx, [one.id], 'again')).toThrow(/triaged/)
    expect(() => triageNotes(ctx, [reopenNote(ctx, one.id).id], '  ')).toThrow(/empty/)
    const foreign = seedFeature(ctx, seedProject(ctx).id, { slug: 'foreign' })
    expect(() => triageNotes(ctx, [one.id], 'move', foreign.id)).toThrow(/same project/)
    expect(dismissNote(ctx, one.id).outcome).toBe('dismissed')
    expect(reopenNote(ctx, one.id)).toMatchObject({ status: 'open', outcome: undefined, featureId: undefined })
  })

  it('derives screenshot URL from disk and emits project-scoped events for every mutation', () => {
    const note = addNote(ctx, projectId, 'image')
    expect(note.screenshotUrl).toBeUndefined()
    attachScreenshot(ctx, note.id, new Uint8Array([1, 2, 3]))
    expect(readFileSync(projectNotePath(note.id))).toEqual(Buffer.from([1, 2, 3]))
    expect(listNotes(ctx, projectId)[0].screenshotUrl).toBe(`/api/reviews/project-note/${note.id}/screenshot.png`)
    editNote(ctx, note.id, 'edited')
    dismissNote(ctx, note.id)
    reopenNote(ctx, note.id)
    deleteNote(ctx, note.id)
    const events = listByProject(ctx, projectId)
    expect(events.map((event) => event.type)).toEqual([
      'project_note.added', 'project_note.screenshot', 'project_note.edited',
      'project_note.dismissed', 'project_note.reopened', 'project_note.deleted',
    ])
    expect(events.every((event) => event.featureId === undefined)).toBe(true)
  })
})
