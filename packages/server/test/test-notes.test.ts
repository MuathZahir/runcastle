import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { annotationPath } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError, NotFoundError } from '../src/errors'
import { listAfter } from '../src/services/events'
import {
  addNote,
  attachScreenshot,
  deleteNote,
  editNote,
  listByFeature,
  promoteMany,
  promoteNote,
  toggleNote,
} from '../src/services/test-notes'
import { listByFeature as listTickets } from '../src/services/tickets'
import { useDataDir } from './helpers/data-dir'
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

  /** The rendered view, read from where the next lap's session will read it. */
  function renderedFile(slug = feature.slug): string {
    return readFileSync(
      join(project.repoPath, 'docs', 'features', slug, 'test-notes.md'),
      'utf8',
    )
  }

  function eventTypes(): string[] {
    return listAfter(ctx, feature.id).map((e) => e.type)
  }

  it('captures an open note stamped with the feature current lap', () => {
    const onLapTwo = seedFeature(ctx, project.id, { slug: 'later', lap: 2 })

    const note = addNote(ctx, feature.id, 'the header wraps at 400px')

    expect(note).toMatchObject({ text: 'the header wraps at 400px', status: 'open', lap: 1 })
    expect(note.ticketId).toBeUndefined()
    expect(listByFeature(ctx, feature.id)).toEqual([note])
    expect(addNote(ctx, onLapTwo.id, 'still wraps').lap).toBe(2)
    expect(eventTypes()).toContain('note.added')
  })

  it('trims note text and rejects empty text', () => {
    expect(addNote(ctx, feature.id, '  spacing is off  ').text).toBe('spacing is off')
    expect(() => addNote(ctx, feature.id, '   \n ')).toThrow(InvalidInputError)
    expect(listByFeature(ctx, feature.id)).toHaveLength(1)
  })

  it('edits an open note and rejects editing a done or promoted one', () => {
    const note = addNote(ctx, feature.id, 'teh header wraps')

    const edited = editNote(ctx, note.id, 'the header wraps')
    expect(edited.text).toBe('the header wraps')
    expect(eventTypes()).toContain('note.edited')

    toggleNote(ctx, note.id)
    expect(() => editNote(ctx, note.id, 'nope')).toThrow(InvalidInputError)

    const promoted = addNote(ctx, feature.id, 'promote me')
    promoteNote(ctx, promoted.id)
    expect(() => editNote(ctx, promoted.id, 'nope')).toThrow(InvalidInputError)
  })

  it('deletes an open note and rejects deleting a promoted one', () => {
    const note = addNote(ctx, feature.id, 'a dead observation')

    deleteNote(ctx, note.id)
    expect(listByFeature(ctx, feature.id)).toEqual([])
    expect(eventTypes()).toContain('note.deleted')
    expect(renderedFile()).toBe('# Test notes\n')

    tick()
    const promoted = addNote(ctx, feature.id, 'promote me')
    promoteNote(ctx, promoted.id)
    expect(() => deleteNote(ctx, promoted.id)).toThrow(InvalidInputError)
  })

  it('toggles a note open <-> done and rejects toggling a promoted one', () => {
    const note = addNote(ctx, feature.id, 'looks fine actually')

    expect(toggleNote(ctx, note.id).status).toBe('done')
    expect(toggleNote(ctx, note.id).status).toBe('open')
    expect(eventTypes().filter((t) => t === 'note.toggled')).toHaveLength(2)

    promoteNote(ctx, note.id)
    expect(() => toggleNote(ctx, note.id)).toThrow(InvalidInputError)
  })

  it('promotes an open note into one pending ticket on the current lap', () => {
    const onLapTwo = seedFeature(ctx, project.id, { slug: 'wide-app', lap: 2 })
    const note = addNote(
      ctx,
      onLapTwo.id,
      'the sidebar collapses when the window is narrower than the content, hiding the nav',
    )

    const { note: promoted, ticket } = promoteNote(ctx, note.id)

    expect(promoted.status).toBe('promoted')
    expect(promoted.ticketId).toBe(ticket.id)
    expect(listTickets(ctx, onLapTwo.id)).toHaveLength(1)
    expect(ticket).toMatchObject({
      seq: 1,
      status: 'pending',
      lap: 2,
      title: 'the sidebar collapses when the window is narrower than the…',
      goal: 'the sidebar collapses when the window is narrower than the content, hiding the nav',
      acceptanceCriteria: [
        'The noted behavior no longer reproduces: the sidebar collapses when the window is narrower than the content, hiding the nav',
      ],
      seams: [],
      blockedBy: [],
    })
    expect(ticket.context).toBe(
      'Found during lap 2 test drive of wide-app.\n\n' +
        'Read docs/features/wide-app/spec.md and docs/features/wide-app/decisions.md for what this feature is meant to do.',
    )
    expect(listAfter(ctx, onLapTwo.id).map((e) => e.type)).toContain('note.promoted')
  })

  it('rejects promoting a done or already promoted note', () => {
    const done = addNote(ctx, feature.id, 'checked off')
    toggleNote(ctx, done.id)
    expect(() => promoteNote(ctx, done.id)).toThrow(InvalidInputError)

    tick()
    const note = addNote(ctx, feature.id, 'promote me once')
    promoteNote(ctx, note.id)
    expect(() => promoteNote(ctx, note.id)).toThrow(InvalidInputError)
    expect(listTickets(ctx, feature.id)).toHaveLength(1)
  })

  it('promotes a selection of notes in one batch, one ticket per note', () => {
    const first = addNote(ctx, feature.id, 'the run chip goes grey while burning')
    tick()
    const skipped = addNote(ctx, feature.id, 'not this one')
    tick()
    const second = addNote(ctx, feature.id, 'the empty state is stale after a delete')

    const { notes, tickets } = promoteMany(ctx, [first.id, second.id])

    expect(notes.map((n) => n.status)).toEqual(['promoted', 'promoted'])
    expect(tickets.map((t) => t.seq)).toEqual([1, 2])
    expect(tickets.map((t) => t.title)).toEqual([
      'the run chip goes grey while burning',
      'the empty state is stale after a delete',
    ])
    expect(notes.map((n) => n.ticketId)).toEqual(tickets.map((t) => t.id))
    expect(listTickets(ctx, feature.id)).toHaveLength(2)
    // Untouched by a batch it was not in.
    expect(listByFeature(ctx, feature.id).find((n) => n.id === skipped.id)?.status).toBe('open')
  })

  it('emits one promotion event for the whole batch', () => {
    const first = addNote(ctx, feature.id, 'one')
    tick()
    const second = addNote(ctx, feature.id, 'two')

    promoteMany(ctx, [first.id, second.id])

    expect(eventTypes().filter((t) => t === 'notes.promoted')).toHaveLength(1)
    expect(eventTypes()).not.toContain('note.promoted')
  })

  it('rejects a batch with an empty, duplicated or non-open selection, promoting nothing', () => {
    expect(() => promoteMany(ctx, [])).toThrow(InvalidInputError)

    const open = addNote(ctx, feature.id, 'still open')
    tick()
    const done = addNote(ctx, feature.id, 'already handled')
    toggleNote(ctx, done.id)

    expect(() => promoteMany(ctx, [open.id, done.id])).toThrow(InvalidInputError)
    expect(() => promoteMany(ctx, [open.id, open.id])).toThrow(InvalidInputError)
    // Refused before anything was written: no ticket, and the open note is open.
    expect(listTickets(ctx, feature.id)).toEqual([])
    expect(listByFeature(ctx, feature.id).find((n) => n.id === open.id)?.status).toBe('open')
  })

  it('rejects a batch spanning two features — a batch belongs to one ledger', () => {
    const other = seedFeature(ctx, project.id, { slug: 'elsewhere' })
    const here = addNote(ctx, feature.id, 'here')
    const there = addNote(ctx, other.id, 'there')

    expect(() => promoteMany(ctx, [here.id, there.id])).toThrow(InvalidInputError)
    expect(listTickets(ctx, feature.id)).toEqual([])
    expect(listTickets(ctx, other.id)).toEqual([])
  })

  it('regenerates test-notes.md once for the whole batch', () => {
    const first = addNote(ctx, feature.id, 'first finding')
    tick()
    const second = addNote(ctx, feature.id, 'second finding')

    promoteMany(ctx, [first.id, second.id])

    expect(renderedFile()).toBe(
      '# Test notes\n\n## Lap 1\n\n- [x] first finding (→ ticket 1)\n- [x] second finding (→ ticket 2)\n',
    )
  })

  it('renders test-notes.md with lap sections, checkboxes and ticket annotations', () => {
    const lapOne = addNote(ctx, feature.id, 'first lap finding')
    tick()
    addNote(ctx, feature.id, 'first lap, still open')
    toggleNote(ctx, lapOne.id)

    // second lap: same feature, lap bumped the way an iterate would
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()
    tick()
    const toPromote = addNote(ctx, feature.id, 'second lap finding')
    tick()
    addNote(ctx, feature.id, 'second lap, untouched')
    promoteNote(ctx, toPromote.id)

    expect(renderedFile()).toBe(
      [
        '# Test notes',
        '',
        '## Lap 1',
        '',
        '- [x] first lap finding',
        '- [ ] first lap, still open',
        '',
        '## Lap 2',
        '',
        '- [x] second lap finding (→ ticket 1)',
        '- [ ] second lap, untouched',
        '',
      ].join('\n'),
    )
  })

  it('regenerates the file on every mutation rather than appending', () => {
    const note = addNote(ctx, feature.id, 'teh typo')
    expect(renderedFile()).toBe('# Test notes\n\n## Lap 1\n\n- [ ] teh typo\n')

    editNote(ctx, note.id, 'the typo')
    expect(renderedFile()).toBe('# Test notes\n\n## Lap 1\n\n- [ ] the typo\n')

    toggleNote(ctx, note.id)
    expect(renderedFile()).toBe('# Test notes\n\n## Lap 1\n\n- [x] the typo\n')
  })

  /**
   * Notes captured from the walkthrough annotation player: a timestamp on the
   * row, and a PNG whose presence on disk is the only record that it exists
   * (decisions.md #5). The data dir is redirected at a temp tree so the
   * annotations dir these tests write into is disposable.
   */
  describe('annotated notes', () => {
    let home: string
    let restoreDataDir: () => void

    // A real PNG header is not needed at this seam — the service stores bytes and
    // the signature check lives at the HTTP route, where the upload arrives.
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'rc-annotations-'))
      restoreDataDir = useDataDir(home)
    })

    afterEach(() => {
      restoreDataDir()
      rmSync(home, { recursive: true, force: true })
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

    it('carries the screenshot path into test-notes.md, and re-renders on upload', () => {
      const annotated = addNote(ctx, feature.id, 'the panel is misaligned')
      tick()
      addNote(ctx, feature.id, 'just typed this one')

      // Before the upload the rendered file is byte-identical to a plain one.
      expect(renderedFile()).toBe(
        '# Test notes\n\n## Lap 1\n\n- [ ] the panel is misaligned\n- [ ] just typed this one\n',
      )

      // The upload alone re-renders — no other mutation happens in between.
      attachScreenshot(ctx, annotated.id, PNG)

      expect(renderedFile()).toBe(
        [
          '# Test notes',
          '',
          '## Lap 1',
          '',
          `- [ ] the panel is misaligned (screenshot: ${annotationPath(annotated.id)})`,
          '- [ ] just typed this one',
          '',
        ].join('\n'),
      )
    })

    it('keeps the ticket reference and the screenshot path on a promoted line', () => {
      const note = addNote(ctx, feature.id, 'the panel is misaligned')
      attachScreenshot(ctx, note.id, PNG)

      promoteNote(ctx, note.id)

      expect(renderedFile()).toBe(
        `# Test notes\n\n## Lap 1\n\n- [x] the panel is misaligned (→ ticket 1) (screenshot: ${annotationPath(note.id)})\n`,
      )
    })
  })
})
