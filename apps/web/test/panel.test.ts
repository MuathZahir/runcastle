import { describe, expect, it } from 'vitest'
import {
  INITIAL_PANEL,
  availableViews,
  bodyLabel,
  panelReducer,
  type PanelAction,
  type PanelState,
} from '../src/lib/feature-ui/panel'

/** design-mode decisions 4, 5: the views a feature offers and what the panel does. */
describe('availableViews', () => {
  const started = { isDraft: false, hasPreview: false, driveActive: false }

  it('offers the body, design and details in every working phase', () => {
    for (const phase of ['planning', 'building', 'review'] as const) {
      expect(availableViews({ ...started, phase })).toEqual(['body', 'design', 'details'])
    }
  })

  it('drops design once the feature has shipped', () => {
    expect(availableViews({ ...started, phase: 'shipped' })).toEqual(['body', 'details'])
  })

  it('offers the preview only when the feature has one', () => {
    expect(availableViews({ ...started, phase: 'planning', hasPreview: true })).toEqual([
      'body',
      'preview',
      'design',
      'details',
    ])
  })

  it('offers the drive only while one is up', () => {
    expect(availableViews({ ...started, phase: 'review', driveActive: true })).toEqual([
      'body',
      'design',
      'drive',
      'details',
    ])
  })

  it('gives a draft no panel at all', () => {
    expect(availableViews({ isDraft: true, phase: 'planning', hasPreview: true, driveActive: true })).toEqual([])
  })
})

describe('bodyLabel', () => {
  it('names the body after what the phase shows', () => {
    expect(bodyLabel('planning', { ticketsIsBody: false, hasRun: false })).toBe('Plan')
    expect(bodyLabel('planning', { ticketsIsBody: true, hasRun: false })).toBe('Tickets')
    expect(bodyLabel('building', { ticketsIsBody: true, hasRun: false })).toBe('Tickets')
    expect(bodyLabel('building', { ticketsIsBody: false, hasRun: true })).toBe('Run')
    expect(bodyLabel('review', { ticketsIsBody: false, hasRun: true })).toBe('Review')
    expect(bodyLabel('shipped', { ticketsIsBody: false, hasRun: true })).toBe('Outcome')
  })
})

describe('panelReducer', () => {
  const run = (...actions: PanelAction[]): PanelState => actions.reduce(panelReducer, INITIAL_PANEL)

  it('starts closed at an even split', () => {
    expect(INITIAL_PANEL).toEqual({ view: null, share: 0.5, collapsed: false })
  })

  it('opens a view and says who opened it', () => {
    expect(run({ type: 'open', view: 'body', origin: 'human' })).toMatchObject({ view: 'body', origin: 'human' })
  })

  it("keeps the agent's path for the design view, and only for it", () => {
    expect(run({ type: 'open', view: 'design', path: '/preview/x', origin: 'agent' })).toMatchObject({
      view: 'design',
      path: '/preview/x',
      origin: 'agent',
    })
    expect(run({ type: 'open', view: 'body', path: '/preview/x', origin: 'agent' }).path).toBeUndefined()
    expect(run({ type: 'open', view: 'design', origin: 'human' }).path).toBeUndefined()
  })

  it('opens the run after Go and the drive after Test drive, as runcastle', () => {
    expect(run({ type: 'follow', click: 'go' })).toMatchObject({ view: 'body', origin: 'runcastle' })
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

  it('takes a new design path over the remembered one', () => {
    const state = run(
      { type: 'open', view: 'design', path: '/p', origin: 'agent' },
      { type: 'switch', view: 'body' },
      { type: 'open', view: 'design', path: '/q', origin: 'agent' },
    )
    expect(state.path).toBe('/q')
  })

  it('closes to the chat alone, keeping the size', () => {
    const state = run(
      { type: 'open', view: 'body', origin: 'human' },
      { type: 'setWidth', share: 0.7 },
      { type: 'close' },
    )
    expect(state).toEqual({ view: null, last: 'body', share: 0.7, collapsed: false })
  })

  it('the header toggle reopens the last view, and closes an open one', () => {
    const views = ['body', 'design', 'details'] as const
    const closed = run(
      { type: 'open', view: 'body', origin: 'human' },
      { type: 'switch', view: 'details' },
      { type: 'toggle', views },
    )
    expect(closed.view).toBeNull()
    expect(panelReducer(closed, { type: 'toggle', views })).toMatchObject({ view: 'details', origin: 'human' })
  })

  it('the toggle opens the first view on offer when nothing was open, or the last is gone', () => {
    expect(run({ type: 'toggle', views: ['body', 'details'] }).view).toBe('body')
    const driveGone = run({ type: 'open', view: 'drive', origin: 'human' }, { type: 'close' })
    expect(panelReducer(driveGone, { type: 'toggle', views: ['body', 'details'] }).view).toBe('body')
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
    const full = run({ type: 'open', view: 'body', origin: 'human' }, { type: 'setWidth', share: 0.3 }, { type: 'toggleFull' })
    expect(full.share).toBe(1)
    expect(panelReducer(full, { type: 'toggleFull' }).share).toBe(0.5)
  })

  it('collapses an open panel to a strip, and unfolds it on expand or on any open', () => {
    const folded = run({ type: 'open', view: 'body', origin: 'human' }, { type: 'collapse' })
    expect(folded.collapsed).toBe(true)
    expect(panelReducer(folded, { type: 'expand' }).collapsed).toBe(false)
    expect(panelReducer(folded, { type: 'switch', view: 'details' }).collapsed).toBe(false)
    expect(panelReducer(folded, { type: 'open', view: 'design', origin: 'agent' }).collapsed).toBe(false)
    // Nothing open, nothing to fold.
    expect(run({ type: 'collapse' }).collapsed).toBe(false)
  })
})
