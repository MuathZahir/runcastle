import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusStrip } from '../src/components/review/StatusStrip'
import { lapChip, reviewChecks } from '../src/lib/feature-ui'

/**
 * The status strip (decisions 18b, 19, 27a) — the returning human's TL;DR.
 *
 * Tier 1: the whole of the band's behaviour is which chips it emits, in which
 * order, with which words. It is rendered over the REAL derivations rather than
 * over canned chips, because the questions worth asking here — does the review
 * chip stamp its freshness, does the lap chip stop counting the review ticket as
 * landed work — are answered by the strip and `statusChips` together.
 */
describe('StatusStrip', () => {
  const ticket = (over: Partial<{ kind: 'implementation' | 'review'; status: string; lap: number }> = {}) => ({
    kind: 'implementation' as const,
    status: 'done',
    lap: 2,
    ...over,
  })

  const render = (
    props: Partial<Parameters<typeof StatusStrip>[0]> = {},
  ): string =>
    renderToStaticMarkup(
      createElement(StatusStrip, {
        artifact: { lap: 2 },
        currentLap: 2,
        landedSince: 0,
        tickets: [ticket(), ticket({ status: 'failed' })],
        checks: reviewChecks({ tickets: [], run: undefined, commitCount: 3, findings: 0 }),
        runState: 'succeeded',
        lap: lapChip([ticket(), ticket({ status: 'failed' })], { lap: 2, lapSessionRan: true }),
        laterLaps: null,
        readonly: false,
        ...props,
      }),
    )

  it('leads with the review chip and its freshness stamp, then checks, lap and run', () => {
    const html = render()
    const order = ['Reviewed ✓ · this build', 'checks passed', 'Lap 2 ·', 'succeeded']
    let cursor = -1
    for (const fragment of order) {
      const at = html.indexOf(fragment)
      expect(at, fragment).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('stamps evidence that predates the current build as stale, with what landed since', () => {
    const html = render({ artifact: { lap: 1 }, landedSince: 5 })
    expect(html).toContain('Reviewed 1 lap ago · 5 tickets landed since — evidence may be outdated')
  })

  /** Decision 19b: the amber stamp subsumes "no review ran this lap". */
  it('renders no review at all as its own chip state rather than a buried row', () => {
    const html = render({ artifact: null })
    expect(html).toContain('no review yet')
  })

  it('says a verification pass is running over evidence that predates it', () => {
    const html = render({ verification: { state: 'running' } })
    expect(html).toContain('Verification running — evidence below predates it')
  })

  it('carries the reason a verification could not run', () => {
    const html = render({ verification: { state: 'failed', reason: 'sandbox died' } })
    expect(html).toContain('verification could not run: sandbox died')
  })

  /**
   * Walk §B dead end 3: the review ticket was counted among the lap's delivered
   * work, so a lap that landed one feature ticket read as having landed two.
   */
  it('never counts the review ticket as landed work in the lap chip', () => {
    const rows = [ticket(), ticket({ kind: 'review', status: 'done' })]
    const html = render({ tickets: rows, lap: lapChip(rows, { lap: 2, lapSessionRan: true }) })
    expect(html).toContain('Lap 2 · 1 of 1 tickets landed · 0 waived')
  })

  it('counts a cancelled ticket as waived rather than as landed or failed', () => {
    const rows = [ticket(), ticket({ status: 'cancelled' })]
    const html = render({ tickets: rows, lap: lapChip(rows, { lap: 2, lapSessionRan: true }) })
    expect(html).toContain('1 of 2 tickets landed · 1 waived')
  })

  /** Decision 27a: the past tense only once the lap's session has actually run. */
  it('tells the lap`s story in the tense the lap is actually in', () => {
    const open = render({ lap: lapChip([], { lap: 2, lapSessionRan: false }) })
    expect(open).toContain('Lap 2 is open — its session will digest your notes')

    const ran = render({ lap: lapChip([], { lap: 2, lapSessionRan: true }) })
    // React escapes the apostrophe on the way into static markup.
    expect(ran).toContain('Lap 2&#x27;s session digested your notes')
  })

  it('folds the planned next lap into the lap chip`s disclosure', () => {
    const html = render({ laterLaps: 'A settings pane for the roster.' })
    expect(html).toContain('The spec kept this out of lap 2 on purpose')
    expect(html).toContain('Start lap 3 from the next step')
    expect(html).toContain('A settings pane for the roster.')
  })

  it('states the deferred scope as history on a shipped feature', () => {
    const html = render({ laterLaps: 'A settings pane for the roster.', readonly: true })
    expect(html).toContain('still deferred when this feature shipped')
    expect(html).not.toContain('Start lap 3 from the next step')
  })

  it('opens each chip in place or anchors it into the band it summarises', () => {
    const html = render()
    expect(html).toContain('href="#open-work"')
    expect(html).toContain('href="#full-accounts"')
    expect(html).toContain('<details')
  })
})
