import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestNote } from '@runcastle/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NoteThumbnail } from '../src/ui'
import { NoteRow } from '../src/components/review/NoteRow'

/**
 * The one thumbnail both note surfaces wear (apps/web/STYLE.md, Primitives).
 *
 * Tier 1: the primitive is hook-free, so its whole behaviour is the markup it
 * emits. The review row and the project notes card had the same button, image,
 * dimensions, title and alt text written out twice — which is exactly how a
 * lightbox door and its alt text drift apart between two lists of notes.
 */

const URL = '/api/reviews/note/note_1/screenshot.png'

function thumbnail(url: string | null, size?: 'md' | 'sm'): string {
  return renderToStaticMarkup(createElement(NoteThumbnail, { url, onOpen: () => {}, size }))
}

function surface(name: string): string {
  return readFileSync(join(import.meta.dirname, '../src', name), 'utf8')
}

describe('NoteThumbnail', () => {
  it('opens the picture in the app, at a size that can be read', () => {
    const html = thumbnail(URL)

    expect(html).toContain(URL)
    expect(html).toContain('the picture attached to this note')
    // ~96×54 (decision 25a), and a button rather than a link: the full PNG opens
    // in the app's own lightbox, never in a browser tab.
    expect(html).toContain('w-24')
    expect(html).toContain('h-[54px]')
    expect(html).not.toContain('target="_blank"')
  })

  it('renders nothing when the note has no picture', () => {
    expect(thumbnail(null)).toBe('')
    expect(thumbnail(null, 'sm')).toBe('')
  })

  /** The project inbox's dense row (decisions.md #17) wears the same door, smaller. */
  it('comes small, ~40×26, as the same door onto the same picture', () => {
    const html = thumbnail(URL, 'sm')

    expect(html).toContain(URL)
    expect(html).toContain('the picture attached to this note')
    expect(html).toContain('w-10')
    expect(html).toContain('h-[26px]')
    expect(html).not.toContain('h-[54px]')
    // the default is untouched: the review lap's rows keep their size
    expect(thumbnail(URL)).toBe(thumbnail(URL, 'md'))
  })

  it('is what both note surfaces render, rather than each styling its own', () => {
    const note: TestNote = {
      id: 'note_1',
      featureId: 'ftr_1',
      lap: 1,
      text: 'the crumbs overflow on a long title',
      status: 'open',
      author: 'human',
      screenshotUrl: URL,
      createdAt: 1,
      updatedAt: 1,
    }
    const row = renderToStaticMarkup(
      createElement(NoteRow, {
        item: { kind: 'note', note },
        onStage: null,
        readonly: false,
        onOpenImage: () => {},
      }),
    )

    // From `<button` on: React hoists a `<link rel="preload">` for the image
    // ahead of whichever render is the outermost one, so only the element
    // itself is comparable between a row and a bare thumbnail.
    const bare = thumbnail(URL)
    expect(row).toContain(bare.slice(bare.indexOf('<button')))
    for (const name of ['components/review/NoteRow.tsx', 'components/project/NotesCard.tsx']) {
      expect(surface(name)).not.toContain('h-[54px]')
    }
  })
})
