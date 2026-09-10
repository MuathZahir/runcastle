import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { DeniedDriveCard } from '../src/components/review/DeniedDriveCard'
import { reviewDriveDenial } from '../src/lib/feature-ui'

/**
 * The banner's visibility rule (decision 7). Tier 1: what the review panel puts
 * on screen for a denied review drive is decided by one pure read of the event
 * feed and the run list, so that read is tested here and the card that renders
 * it is tested beside it.
 */
const event = (id: number, ts: number, data?: Record<string, unknown>): EventRow => ({
  id,
  projectId: 'prj_1',
  featureId: 'ftr_1',
  ts,
  type: 'reviewdrive.denied',
  message: `review drive denied — 2 uncommitted file(s) in the working tree: src/App.tsx, notes.md`,
  ...(data ? { data } : {}),
})

const denied = event(7, 2_000, { code: 'dirty', dirtyFiles: ['src/App.tsx', 'notes.md'] })
const run = { startedAt: 1_000 }

describe('reviewDriveDenial', () => {
  it('is null when nothing was ever denied', () => {
    expect(reviewDriveDenial([], [run])).toBeNull()
  })

  it('names the dirty files and keeps the server’s own sentence', () => {
    const denial = reviewDriveDenial([denied], [run])
    expect(denial).toEqual({
      eventId: 7,
      dirtyFiles: ['src/App.tsx', 'notes.md'],
      message: denied.message,
      at: 2_000,
    })
  })

  /** The denial has to be the latest word on the latest run, exactly as the
   *  server's retry-eligibility check reads it. */
  it('stands while it is the latest word on the latest run', () => {
    expect(reviewDriveDenial([denied], [{ startedAt: 500 }, run])).not.toBeNull()
  })

  it('clears once a retry burn starts — its run began after the denial', () => {
    expect(reviewDriveDenial([denied], [run, { startedAt: 3_000 }])).toBeNull()
  })

  it('reads the LAST denial when a burn was denied more than once', () => {
    const again = event(9, 4_000, { code: 'dirty', dirtyFiles: ['other.ts'] })
    expect(reviewDriveDenial([denied, again], [run])?.eventId).toBe(9)
  })

  it('ignores every other event on the feed', () => {
    const burn = { ...event(8, 3_000), type: 'burn.started', message: 'burn started' }
    expect(reviewDriveDenial([burn], [run])).toBeNull()
  })

  /** A denial the server recorded without a file list is still a denial. */
  it('survives data it cannot read', () => {
    expect(reviewDriveDenial([event(7, 2_000)], [run])?.dirtyFiles).toEqual([])
  })

  describe('dismissal is keyed on the event id', () => {
    it('hides the denial the human waved away', () => {
      expect(reviewDriveDenial([denied], [run], 7)).toBeNull()
    })

    it('speaks up again on a NEW denial, which is a new id', () => {
      const again = event(9, 4_000, { code: 'dirty', dirtyFiles: ['src/App.tsx'] })
      expect(reviewDriveDenial([denied, again], [run], 7)?.eventId).toBe(9)
    })
  })
})

/**
 * The banner itself. Tier 1: everything it decides is which words and which
 * controls it puts on the page — the two clicks are tier 2, next door.
 */
const denial = {
  eventId: 7,
  dirtyFiles: ['src/App.tsx', 'notes.md'],
  message: 'review drive denied — 2 uncommitted file(s) in the working tree: src/App.tsx, notes.md',
  at: 1_760_000_000_000,
}

const render = (props: Partial<Parameters<typeof DeniedDriveCard>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(DeniedDriveCard, {
      denial,
      readonly: false,
      busy: false,
      refusal: null,
      onRetry: () => undefined,
      onDismiss: () => undefined,
      ...props,
    }),
  )

describe('DeniedDriveCard', () => {
  it('says what was denied, names the dirty files, and offers the retry', () => {
    const html = render()
    expect(html).toContain('Review drive denied')
    expect(html).toContain('src/App.tsx')
    expect(html).toContain('notes.md')
    expect(html).toContain('Retry review')
    expect(html).toContain('Dismiss')
  })

  /** The review did not fail — it fell back — so this is amber, not the
   *  conflict card's red. */
  it('reads as a warning rather than a failure', () => {
    expect(render()).toContain('border-warn/45')
  })

  it('falls back to the server’s sentence when the event carried no file list', () => {
    expect(render({ denial: { ...denial, dirtyFiles: [] } })).toContain('uncommitted file(s)')
  })

  it('renders the refusal verbatim, in the banner, rather than a toast that fades', () => {
    const refusal =
      'the working tree is still dirty — the review drive would be denied again. Commit or ' +
      'discard 1 file(s) first: src/App.tsx'
    expect(render({ refusal })).toContain('discard 1 file(s) first: src/App.tsx')
  })

  it('says nothing about a refusal until one has been handed back', () => {
    expect(render()).not.toContain('still dirty')
  })

  it('holds the retry while it is in flight', () => {
    expect(render({ busy: true })).toContain('Retrying…')
  })

  /** Decision 33a: a history view offers no live control. */
  it('renders nothing at all under readonly', () => {
    expect(render({ readonly: true })).toBe('')
  })
})
