import { describe, expect, it } from 'vitest'
import {
  INITIAL_PANEL,
  PANEL_VIEWS,
  availableViews,
  hasPlan,
  panelReducer,
  panelViewOf,
  type PanelAction,
  type PanelFacts,
  type PanelState,
} from '../src/lib/feature-ui/panel'

/**
 * tickets-and-review-are-tools-not-phases decision 8: the views a feature
 * offers come from facts, never a phase, and the panel's transitions.
 */
describe('availableViews', () => {
  const none: PanelFacts = {
    isDraft: false,
    hasPlan: false,
    hasTickets: false,
    shipped: false,
    designRunning: false,
    driveActive: false,
  }

  it('offers only the details to a started feature with nothing to show yet', () => {
    expect(availableViews(none)).toEqual(['details'])
  })

  it('offers each view once its fact holds, in the switcher’s order', () => {
    expect(availableViews({ ...none, hasPlan: true })).toEqual(['plan', 'details'])
    expect(availableViews({ ...none, hasTickets: true })).toEqual(['work', 'details'])
    expect(availableViews({ ...none, designRunning: true })).toEqual(['details', 'design'])
    expect(availableViews({ ...none, driveActive: true })).toEqual(['details', 'drive'])
  })

  it('adds no view for a ship (decision 14)', () => {
    expect(availableViews({ ...none, shipped: true })).toEqual(['details'])
  })

  it('lists plan, tickets, details, design, drive when every fact holds', () => {
    const all = { isDraft: false, hasPlan: true, hasTickets: true, shipped: true, designRunning: true, driveActive: true }
    expect(availableViews(all)).toEqual(['plan', 'work', 'details', 'design', 'drive'])
  })

  it('gives a draft no panel at all', () => {
    const all = { isDraft: true, hasPlan: true, hasTickets: true, shipped: false, designRunning: true, driveActive: true }
    expect(availableViews(all)).toEqual([])
  })

  it('has no phase-keyed body, no separate preview view and no Review', () => {
    expect(PANEL_VIEWS).toEqual(['plan', 'work', 'details', 'design', 'drive'])
  })
})

describe('panelViewOf', () => {
  it('reads the retired body, preview and review names as Tickets and Plan', () => {
    expect(panelViewOf('body')).toBe('work')
    expect(panelViewOf('preview')).toBe('plan')
    expect(panelViewOf('review')).toBe('work')
    expect(panelViewOf('nonsense')).toBeNull()
  })
})

describe('the facts behind Plan', () => {
  it('has a plan with a preview, decisions.md or spec.md, and none with only the brief', () => {
    const doc = (relPath: string) => ({ relPath })
    expect(hasPlan({ docs: [doc('docs/features/x/brief.md')] })).toBe(false)
    expect(hasPlan({ preview: { relPath: 'preview.html' }, docs: [] })).toBe(true)
    expect(hasPlan({ docs: [doc('docs/features/x/decisions.md')] })).toBe(true)
    expect(hasPlan({ docs: [doc('docs/features/x/spec.md')] })).toBe(true)
  })
})

describe('panelReducer', () => {
  const run = (...actions: PanelAction[]): PanelState => actions.reduce(panelReducer, INITIAL_PANEL)

  it('starts closed at an even split', () => {
    expect(INITIAL_PANEL).toEqual({ view: null, share: 0.5, collapsed: false })
  })

  it('opens a view and says who opened it', () => {
    expect(run({ type: 'open', view: 'work', origin: 'human' })).toMatchObject({ view: 'work', origin: 'human' })
  })

  it("keeps the agent's path for the design view, and only for it", () => {
    expect(run({ type: 'open', view: 'design', path: '/preview/x', origin: 'agent' })).toMatchObject({
      view: 'design',
      path: '/preview/x',
      origin: 'agent',
    })
    expect(run({ type: 'open', view: 'work', path: '/preview/x', origin: 'agent' }).path).toBeUndefined()
    expect(run({ type: 'open', view: 'design', origin: 'human' }).path).toBeUndefined()
  })

  it('opens the run after Go and the drive after Test drive, as runcastle', () => {
    expect(run({ type: 'follow', click: 'testDrive' })).toMatchObject({ view: 'drive', origin: 'runcastle' })
  })

  it('switches views keeping the size, and keeps the design path for the way back', () => {
    const away = run(
      { type: 'open', view: 'design', path: '/p', origin: 'agent' },
      { type: 'setWidth', share: 0.3 },
      { type: 'switch', view: 'details' },
    )
    expect(away).toMatchObject({ view: 'details', share: 0.3, origin: 'human' })
    expect(panelReducer(away, { type: 'switch', view: 'design' })).toMatchObject({ view: 'design', path: '/p' })
    expect(panelReducer(away, { type: 'open', view: 'design', origin: 'human' })).toMatchObject({
      view: 'design',
      path: '/p',
    })
  })

  it("holds the agent's screen width for that design open only", () => {
    const asked = run({ type: 'open', view: 'design', path: '/p', width: 390, origin: 'agent' })
    expect(asked).toMatchObject({ view: 'design', width: 390 })
    expect(panelReducer(asked, { type: 'switch', view: 'work' }).width).toBe(390)
    expect(panelReducer(asked, { type: 'open', view: 'design', origin: 'human' }).width).toBeUndefined()
    expect(panelReducer(asked, { type: 'close' }).width).toBeUndefined()
    expect(run({ type: 'open', view: 'work', width: 390, origin: 'agent' }).width).toBeUndefined()
  })

  it('takes a new design path over the remembered one', () => {
    const state = run(
      { type: 'open', view: 'design', path: '/p', origin: 'agent' },
      { type: 'switch', view: 'work' },
      { type: 'open', view: 'design', path: '/q', origin: 'agent' },
    )
    expect(state.path).toBe('/q')
  })

  it('closes to the chat alone, keeping the size', () => {
    const state = run(
      { type: 'open', view: 'work', origin: 'human' },
      { type: 'setWidth', share: 0.7 },
      { type: 'close' },
    )
    expect(state).toEqual({ view: null, last: 'work', share: 0.7, collapsed: false })
  })

  it('the header toggle reopens the last view, and closes an open one', () => {
    const views = ['work', 'design', 'details'] as const
    const closed = run(
      { type: 'open', view: 'work', origin: 'human' },
      { type: 'switch', view: 'details' },
      { type: 'toggle', views },
    )
    expect(closed.view).toBeNull()
    expect(panelReducer(closed, { type: 'toggle', views })).toMatchObject({ view: 'details', origin: 'human' })
  })

  it('the toggle opens the first view on offer when nothing was open, or the last is gone', () => {
    expect(run({ type: 'toggle', views: ['work', 'details'] }).view).toBe('work')
    const driveGone = run({ type: 'open', view: 'drive', origin: 'human' }, { type: 'close' })
    expect(panelReducer(driveGone, { type: 'toggle', views: ['work', 'details'] }).view).toBe('work')
    expect(run({ type: 'toggle', views: [] }).view).toBeNull()
  })

  it('counts a view the shell opened as the last one when it closes', () => {
    const state = panelReducer({ ...INITIAL_PANEL, view: 'details' }, { type: 'close' })
    expect(state.last).toBe('details')
  })

  it('lets either side shrink to nothing, and no further', () => {
    expect(run({ type: 'setWidth', share: 0 }).share).toBe(0)
    expect(run({ type: 'setWidth', share: 1 }).share).toBe(1)
    expect(run({ type: 'setWidth', share: -0.4 }).share).toBe(0)
    expect(run({ type: 'setWidth', share: 1.8 }).share).toBe(1)
    expect(run({ type: 'setWidth', share: Number.NaN }).share).toBe(0.5)
  })

  it('toggles between the panel full and an even split', () => {
    const full = run({ type: 'open', view: 'work', origin: 'human' }, { type: 'setWidth', share: 0.3 }, { type: 'toggleFull' })
    expect(full.share).toBe(1)
    expect(panelReducer(full, { type: 'toggleFull' }).share).toBe(0.5)
  })

  it('collapses an open panel to a strip, and unfolds it on expand or on any open', () => {
    const folded = run({ type: 'open', view: 'work', origin: 'human' }, { type: 'collapse' })
    expect(folded.collapsed).toBe(true)
    expect(panelReducer(folded, { type: 'expand' }).collapsed).toBe(false)
    expect(panelReducer(folded, { type: 'switch', view: 'details' }).collapsed).toBe(false)
    expect(panelReducer(folded, { type: 'open', view: 'design', origin: 'agent' }).collapsed).toBe(false)
    // Nothing open, nothing to fold.
    expect(run({ type: 'collapse' }).collapsed).toBe(false)
  })
})

describe('a doc read in the panel (the-feature-s-right-panel decision 7)', () => {
  const run = (...actions: PanelAction[]): PanelState => actions.reduce(panelReducer, INITIAL_PANEL)
  const reading = run({ type: 'open', view: 'details', origin: 'human' }, { type: 'openDoc', doc: 'notes/a.md' })

  it('reads the doc in the open view, and the way back returns to that view', () => {
    expect(reading).toMatchObject({ view: 'details', doc: 'notes/a.md' })
    const back = panelReducer(reading, { type: 'closeDoc' })
    expect(back.view).toBe('details')
    expect(back.doc).toBeUndefined()
  })

  it('unfolds a folded panel to show the doc', () => {
    const folded = run({ type: 'open', view: 'work', origin: 'human' }, { type: 'collapse' })
    expect(panelReducer(folded, { type: 'openDoc', doc: 'spec.md' })).toMatchObject({ doc: 'spec.md', collapsed: false })
  })

  it('opens nothing with no view on show', () => {
    expect(run({ type: 'openDoc', doc: 'spec.md' }).doc).toBeUndefined()
  })

  it('drops the doc on a switch, even to the same view, and on close', () => {
    expect(panelReducer(reading, { type: 'switch', view: 'work' }).doc).toBeUndefined()
    expect(panelReducer(reading, { type: 'switch', view: 'details' }).doc).toBeUndefined()
    expect(panelReducer(reading, { type: 'close' }).doc).toBeUndefined()
    expect(panelReducer(reading, { type: 'toggle', views: ['details'] }).doc).toBeUndefined()
  })

  it('drops the doc when another view opens, and keeps it when the open view is asked for again', () => {
    expect(panelReducer(reading, { type: 'open', view: 'design', origin: 'agent' }).doc).toBeUndefined()
    expect(panelReducer(reading, { type: 'follow', click: 'testDrive' }).doc).toBeUndefined()
    expect(panelReducer(reading, { type: 'open', view: 'details', origin: 'agent' }).doc).toBe('notes/a.md')
  })
})
