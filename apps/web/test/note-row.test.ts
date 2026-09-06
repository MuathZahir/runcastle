import type { ReviewFinding, TestNote } from '@runcastle/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NoteRow, type NoteItem } from '../src/components/review/NoteRow'

/**
 * The one row anatomy open work and triage share (decisions 25a / 26a).
 *
 * Tier 1: `NoteRow` is hook-free by design — the list above it reads the queries
 * once and hands each row its data — so its whole behaviour is which elements it
 * emits for a note, for a defect, and under `readonly`.
 */

const NOTE: TestNote = {
  id: 'note_1',
  featureId: 'ftr_1',
  lap: 2,
  text: 'the run chip goes grey while burning\nand stays grey after it lands',
  status: 'open',
  author: 'human',
  videoTimestamp: 42,
  reviewTicketId: 'tkt_review_2',
  screenshotUrl: '/api/reviews/note/note_1/screenshot.png',
  createdAt: 1,
  updatedAt: 1,
}

const DEFECT: ReviewFinding = {
  id: 'find_1',
  featureId: 'ftr_1',
  lap: 2,
  reviewTicketId: 'tkt_review_2',
  kind: 'defect',
  severity: 'high',
  title: 'the merge dialog is blind to a standing conflict',
  location: 'apps/web/src/components/MergeFeatureDialog.tsx',
  citation: 'decision 29',
  detail: 'The dialog renders all-green over a branch that will re-conflict.',
  reproStep: 'Open the dialog over a conflict.',
  status: 'open',
  openReason: 'over-cap',
  failureReason: null,
  fixTicketId: null,
  createdAt: 1,
}

const ON_STAGE = { ticketId: 'tkt_review_2' }

function render(
  item: NoteItem,
  over: Partial<Parameters<typeof NoteRow>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(NoteRow, {
      item,
      onStage: ON_STAGE,
      readonly: false,
      onOpenImage: () => undefined,
      ...over,
    }),
  )
}

const note = (over: Partial<TestNote> = {}): NoteItem => ({
  kind: 'note',
  note: { ...NOTE, ...over },
})

describe('NoteRow', () => {
  it('leads a note with its picture, at a size that can be read', () => {
    const html = render(note())
    expect(html).toContain(NOTE.screenshotUrl!)
    // ~96×54 (decision 25a), and a button rather than a link: the full PNG opens
    // in the app's own lightbox, never in a browser tab.
    expect(html).toContain('w-24')
    expect(html).toContain('h-[54px]')
    expect(html).not.toContain('target="_blank"')
  })

  it('carries the whole note, not a headline the human has to open', () => {
    const html = render(note())
    expect(html).toContain('and stays grey after it lands')
    expect(html).toContain('whitespace-pre-wrap')
  })

  it('makes the timestamp a live jump only into the recording it was taken against', () => {
    expect(render(note())).toContain('>0:42<')

    // Same note, a different recording on the stage: the moment is a label and
    // the baked picture is the evidence (decision 22).
    const orphaned = render(note(), { onStage: { ticketId: 'tkt_review_3' } })
    expect(orphaned).toContain('0:42 · earlier walkthrough')
    expect(orphaned).not.toContain('jump the walkthrough to this moment')

    // Nothing on the stage at all is the same case.
    expect(render(note(), { onStage: null })).toContain('earlier walkthrough')
  })

  it('shows no timestamp at all for a note that came from no recording', () => {
    const html = render(note({ videoTimestamp: undefined, reviewTicketId: undefined }))
    expect(html).not.toContain('earlier walkthrough')
    expect(html).not.toContain('0:00')
  })

  it('badges the review agent’s notes and leaves the human’s unbadged', () => {
    expect(render(note({ author: 'agent' }))).toContain('>agent<')
    expect(render(note())).not.toContain('>agent<')
  })

  it('names the lap only when the list spans more than one', () => {
    expect(render(note(), { showLap: true })).toContain('Lap 2')
    expect(render(note())).not.toContain('Lap 2')
  })

  it('renders a defect in the same anatomy, with its severity and why it is open', () => {
    const html = render({ kind: 'defect', finding: DEFECT })
    expect(html).toContain('the merge dialog is blind to a standing conflict')
    expect(html).toContain('>high<')
    expect(html).toContain('over the auto-fix cap')
    // The review's own prose is a disclosure, never the row (decision 5 item 4).
    expect(html).toContain('<details')
  })

  it('links a fixing defect to the lane fixing it', () => {
    const html = render(
      { kind: 'defect', finding: DEFECT, fixTicket: { id: 'tkt_9', seq: 9 } },
      { onViewLane: () => undefined },
    )
    expect(html).toContain('being fixed in the running burn · lane #9')
  })

  it('states the fix as history when there is nowhere live to go', () => {
    const html = render(
      { kind: 'defect', finding: DEFECT, fixTicket: { id: 'tkt_9', seq: 9 } },
      { readonly: true, onViewLane: () => undefined },
    )
    expect(html).toContain('fixed in the burn by #9')
    expect(html).not.toContain('being fixed in the running burn')
  })

  it('keeps the evidence and drops the controls when the page is history', () => {
    const controls = createElement('button', null, 'Delete')
    expect(render(note(), { controls })).toContain('>Delete<')

    const history = render(note(), { controls, readonly: true })
    expect(history).not.toContain('>Delete<')
    expect(history).toContain(NOTE.screenshotUrl!)
    expect(history).toContain('the run chip goes grey while burning')
  })

  it('lets an editor take the text’s place without taking the evidence with it', () => {
    const html = render(note(), { editor: createElement('textarea', { defaultValue: 'x' }) })
    expect(html).toContain('<textarea')
    // The picture and the moment stay up while the words are being changed
    // (decision 25d).
    expect(html).toContain(NOTE.screenshotUrl!)
    expect(html).toContain('>0:42<')
  })
})
