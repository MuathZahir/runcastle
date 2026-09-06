import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import { triageFooter, triageRoad } from '../src/lib/feature-ui'
import { TriagePanel, TriageStep } from '../src/components/review/TriageStep'

/**
 * The Iterate door (decisions 21 and 26).
 *
 * Tier 1: the step is hook-free apart from its own tick-boxes — its rows, its
 * standing debt and its commit all arrive as props — so what is asserted here is
 * the markup it emits. The dialog mechanics around it are the foundation
 * `Dialog`'s and are covered by `dialog.test.tsx`; the road the ticked boxes
 * choose and the footer's copy are pure derivations, asserted directly, which is
 * how the "all quick fixes" and "mixed" cases are reached without a DOM to click
 * in (decision 36).
 */

const note = (over: Partial<TestNote> & { id: string }): TestNote => ({
  featureId: 'ftr_1',
  lap: 2,
  text: 'the run chip goes grey while burning',
  status: 'open',
  author: 'human',
  createdAt: 100,
  updatedAt: 100,
  ...over,
})

const defect = (over: Partial<ReviewFinding> & { id: string }): ReviewFinding => ({
  featureId: 'ftr_1',
  lap: 2,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'high',
  title: 'the save drops the edited value',
  location: 'packages/server/src/save.ts:42',
  citation: 'spec.md §Save',
  detail: 'The save writes the row and re-reads the stale copy.',
  reproStep: 'Edit a ticket title, save, reload — the old title is back.',
  status: 'open',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  createdAt: 100,
  ...over,
})

const panel = (over: Partial<Parameters<typeof TriagePanel>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(TriagePanel, {
      lap: 2,
      notes: [note({ id: 'note_1' })],
      defects: [defect({ id: 'find_1' })],
      standing: [],
      openedAt: 1000,
      busy: false,
      readonly: false,
      onCommit: vi.fn(),
      onClose: vi.fn(),
      ...over,
    }),
  )

describe('the triage step', () => {
  it('lists the open defects and the open notes as one kind of row', () => {
    const html = panel()
    expect(html).toContain('the save drops the edited value')
    expect(html).toContain('the run chip goes grey while burning')
  })

  // Unchecked is the default because minting a ticket is the mechanical act the
  // human opts into per row — the walked dialog pre-checked everything and made
  // them un-tick what was not.
  it('gives every row one Quick fix checkbox, unchecked', () => {
    const html = panel()
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html).not.toContain('checked=""')
    expect(html).toContain('Quick fix')
    expect(html).toContain('Mark all as quick fixes')
    expect(html).toContain('Clear')
  })

  it('offers a dismiss per row and no per-row discuss control', () => {
    const html = panel()
    expect(html.match(/>Dismiss</g)).toHaveLength(2)
    expect(html).not.toContain('Discuss')
  })

  // The step does not drive the player behind itself, so a timestamp is a label
  // (decision 26a) — never a button that seeks a stage nobody can see.
  it('renders a timestamp as a label, with its picture in reach', () => {
    const html = panel({
      notes: [
        note({
          id: 'note_1',
          videoTimestamp: 42,
          reviewTicketId: 'tkt_review',
          screenshotUrl: '/api/reviews/note/note_1/screenshot.png',
        }),
      ],
      defects: [],
    })
    expect(html).toContain('0:42')
    expect(html).not.toContain('jump the walkthrough to this moment')
    expect(html).toContain('see the whole picture')
  })

  it('groups the rows by lap when the open work spans laps', () => {
    const html = panel({
      notes: [note({ id: 'note_1', lap: 1 }), note({ id: 'note_2', lap: 2 })],
      defects: [],
    })
    expect(html).toContain('Lap 1')
    expect(html).toContain('Lap 2')
  })

  // A note written while the step is open joins the list marked and unticked
  // (decision 26f) — the human sees it arrive rather than committing without it.
  it('marks a row that arrived while the step was open', () => {
    const fresh = panel({ notes: [note({ id: 'note_1', createdAt: 2000 })], defects: [] })
    const old = panel({ notes: [note({ id: 'note_1', createdAt: 900 })], defects: [] })
    expect(fresh).toContain('bg-accent-soft')
    expect(old).not.toContain('bg-accent-soft')
  })

  it('opens on the lap road with nothing ticked, and says what it will carry', () => {
    const html = panel({ notes: [note({ id: 'note_1' }), note({ id: 'note_2' })], defects: [] })
    expect(html).toContain('Start lap 3')
    expect(html).toContain('2 notes carried into the lap conversation')
  })

  it('names the standing debt that will burn along with these', () => {
    expect(panel({ standing: [{ count: 3, lap: 1 }] })).toContain(
      '3 unburned fix tickets from lap 1 will burn with these',
    )
  })

  it('says why the lap conversation cannot open, and disables that road', () => {
    const html = panel({ iterateBlocked: 'One terminal per feature — end the live session first.' })
    expect(html).toContain('One terminal per feature')
    expect(html).toContain('disabled=""')
  })

  it('skips itself when there is nothing open', () => {
    const html = panel({ notes: [], defects: [] })
    expect(html).toContain('Nothing open to triage')
    expect(html).not.toContain('type="checkbox"')
  })

  // Readonly is a rule of the layout, not a per-call-site patch (decision 33a):
  // a shipped feature's review is history, and history has no door out.
  it('renders nothing at all in a readonly view', () => {
    expect(
      renderToStaticMarkup(
        createElement(TriageStep, {
          lap: 2,
          notes: [note({ id: 'note_1' })],
          defects: [],
          standing: [],
          openedAt: 0,
          busy: false,
          readonly: true,
          onCommit: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    ).toBe('')
  })
})

/**
 * What the ticked boxes decide — the road out and the footer's account of it.
 * Both are pure, so every combination is reachable here rather than through a
 * DOM per case.
 */
describe('the road out of triage', () => {
  it('carries everything into the conversation when nothing is ticked', () => {
    expect(triageRoad({ quickFix: 0, carried: 4, nextLap: 3 })).toEqual({
      road: 'lap',
      label: 'Start lap 3',
    })
  })

  it('burns without a conversation when the whole list is quick fixes', () => {
    expect(triageRoad({ quickFix: 2, carried: 0, nextLap: 3 })).toEqual({
      road: 'burn',
      label: 'Mint 2 tickets and burn',
    })
    expect(triageRoad({ quickFix: 1, carried: 0, nextLap: 3 }).label).toBe('Mint 1 ticket and burn')
  })

  it('mints and carries in one act when the list is mixed', () => {
    expect(triageRoad({ quickFix: 2, carried: 4, nextLap: 3 })).toEqual({
      road: 'lap',
      label: 'Mint 2 · carry 4 → Start lap 3',
    })
  })

  it('states the same three cases in the footer', () => {
    expect(triageFooter({ quickFix: 0, carried: 4, nextLap: 3, standing: [] })).toContain(
      '4 notes carried into the lap conversation',
    )
    expect(triageFooter({ quickFix: 3, carried: 0, nextLap: 3, standing: [] })).toBe(
      '3 tickets will mint',
    )
    expect(triageFooter({ quickFix: 1, carried: 2, nextLap: 3, standing: [] })).toBe(
      '1 ticket will mint · 2 notes carried into the lap conversation',
    )
  })
})
