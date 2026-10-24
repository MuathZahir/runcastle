import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { annotationPath } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError, NotFoundError } from '../src/errors'
import { listAfter } from '../src/services/events'
import {
  addNote,
  attachScreenshot,
  deleteNote,
  editNote,
  listByFeature,
} from '../src/services/test-notes'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('test notes service', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id)
    // Notes are ordered by capture time; a human cannot type two notes in the
    // same millisecond but a test can, so drive the clock deliberately.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Advance the clock so the next note sorts after the previous one. */
  function tick(): void {
    vi.advanceTimersByTime(1000)
  }

  function eventTypes(): string[] {
    return listAfter(ctx, feature.id).map((e) => e.type)
  }

  it('captures an open note, with no lap', () => {
    const note = addNote(ctx, feature.id, 'the header wraps at 400px')

    expect(note).toMatchObject({ text: 'the header wraps at 400px', status: 'open' })
    expect(note).not.toHaveProperty('lap')
    expect(note.ticketId).toBeUndefined()
    expect(listByFeature(ctx, feature.id)).toEqual([note])
    expect(eventTypes()).toContain('note.added')
  })

  it('edits and deletes a note, and files nothing into the repo', () => {
    const note = addNote(ctx, feature.id, 'teh header wraps')

    expect(editNote(ctx, note.id, 'the header wraps').text).toBe('the header wraps')
    expect(eventTypes()).toContain('note.edited')

    deleteNote(ctx, note.id)
    expect(listByFeature(ctx, feature.id)).toEqual([])
    expect(eventTypes()).toContain('note.deleted')
    expect(existsSync(join(project.repoPath, 'docs', 'features', feature.slug, 'test-notes.md'))).toBe(false)
  })

  it('trims note text and rejects empty text', () => {
    expect(addNote(ctx, feature.id, '  spacing is off  ').text).toBe('spacing is off')
    expect(() => addNote(ctx, feature.id, '   \n ')).toThrow(InvalidInputError)
    expect(listByFeature(ctx, feature.id)).toHaveLength(1)
  })

  /**
   * Notes captured from the walkthrough annotation player: a timestamp on the
   * row, and a PNG whose presence on disk is the only record that it exists
   * (decisions.md #5). The data dir is redirected at a temp tree so the
   * annotations dir these tests write into is disposable.
   */
  describe('annotated notes', () => {
    let restoreDataDir: () => void

    // A real PNG header is not needed at this seam — the service stores bytes and
    // the signature check lives at the HTTP route, where the upload arrives.
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

    beforeEach(() => {
      restoreDataDir = withTempDataDir()
    })

    afterEach(() => {
      restoreDataDir()
    })

    it('stores the moment in the walkthrough a note was captured at', () => {
      const annotated = addNote(ctx, feature.id, 'the panel is misaligned', 'human', 12.5)
      tick()
      const typed = addNote(ctx, feature.id, 'just typed this one')

      expect(annotated.videoTimestamp).toBe(12.5)
      // Sub-second scrub positions survive: the column is real, not integer.
      expect(listByFeature(ctx, feature.id)[0].videoTimestamp).toBe(12.5)
      expect(typed.videoTimestamp).toBeUndefined()
    })

    it('stamps screenshotUrl from the disk, on the note whose PNG is there', () => {
      const annotated = addNote(ctx, feature.id, 'circled the header')
      tick()
      const plain = addNote(ctx, feature.id, 'no picture for this one')

      expect(listByFeature(ctx, feature.id).map((n) => n.screenshotUrl)).toEqual([
        undefined,
        undefined,
      ])

      attachScreenshot(ctx, annotated.id, PNG)

      const [withShot, without] = listByFeature(ctx, feature.id)
      expect(withShot.screenshotUrl).toBe(`/api/reviews/note/${annotated.id}/screenshot.png`)
      expect(without.screenshotUrl).toBeUndefined()
      expect(plain.screenshotUrl).toBeUndefined()
    })

    it('writes the PNG note-keyed, and emits so the notes list refreshes', () => {
      const note = addNote(ctx, feature.id, 'circled the header')

      const returned = attachScreenshot(ctx, note.id, PNG)

      expect(readFileSync(annotationPath(note.id))).toEqual(Buffer.from(PNG))
      expect(returned.screenshotUrl).toBe(`/api/reviews/note/${note.id}/screenshot.png`)
      expect(eventTypes()).toContain('note.screenshot')
    })

    it('refuses a screenshot for a note that does not exist', () => {
      expect(() => attachScreenshot(ctx, 'note_nope', PNG)).toThrow(NotFoundError)
      expect(existsSync(annotationPath('note_nope'))).toBe(false)
    })

    it('deletes the PNG with its note, and deletes an unannotated note fine', () => {
      const annotated = addNote(ctx, feature.id, 'circled the header')
      attachScreenshot(ctx, annotated.id, PNG)
      tick()
      const plain = addNote(ctx, feature.id, 'no picture for this one')

      deleteNote(ctx, annotated.id)
      expect(existsSync(annotationPath(annotated.id))).toBe(false)

      // No PNG to clean up — the delete still goes through rather than erroring.
      deleteNote(ctx, plain.id)
      expect(listByFeature(ctx, feature.id)).toEqual([])
    })
  })
})
