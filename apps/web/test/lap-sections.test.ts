import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { groupByLap } from '../src/lib/feature-ui'
import { LapSections } from '../src/ui'

/**
 * Ticket 8 / decisions.md #6 — the ledger and the notes inbox both render their
 * rows through LapSections, so "what was done this lap" has to be legible from
 * the component itself. Rendered to static markup rather than driven through a
 * DOM: the whole of the component's behaviour is which headers it emits.
 */
describe('LapSections', () => {
  interface Row {
    lap: number
    id: string
  }

  const row = (lap: number, id: string): Row => ({ lap, id })

  /** The two call sites both pass the feature's own lap, so the helper does too. */
  const render = (rows: Row[], currentLap: number) =>
    renderToStaticMarkup(
      createElement(LapSections<Row>, {
        groups: groupByLap(rows, currentLap),
        currentLap,
        meta: (g) => `${g.rows.length} rows`,
        children: (visible) => visible.map((r) => createElement('span', { key: r.id }, r.id)),
      }),
    )

  it('renders a lap-1 feature flat, with no lap header', () => {
    const html = render([row(1, 'a'), row(1, 'b')], 1)
    expect(html).not.toContain('lap-group')
    expect(html).toContain('<span>a</span><span>b</span>')
  })

  /**
   * The bug this ticket fixes: suppression used to key on how many laps had
   * rows, so a lap-2 feature carrying only lap-1 leftovers read exactly like a
   * lap-1 feature — while the lap banner directly above it said LAP 2.
   */
  it('heads a lap-2 feature`s only group, even when every row is a lap-1 carryover', () => {
    const html = render([row(1, 'a'), row(1, 'b')], 2)
    expect(html).toContain('Lap 1')
    expect(html).toContain('2 rows')
    expect(html).toContain('<span>a</span>')
  })

  it('expands the current lap and collapses the ones before it', () => {
    const html = render([row(1, 'a'), row(2, 'b')], 2)
    expect(html).toContain('Lap 1')
    expect(html).toContain('Lap 2')
    // Earlier laps are a click away; the current one is always open.
    expect(html).toMatch(/<details class="lap-group group"[^>]*>.*Lap 1/)
    expect(html).toMatch(/<section class="lap-group"[^>]*>.*Lap 2/)
  })

  it('renders nothing when there are no rows at all', () => {
    expect(render([], 2)).toBe('')
  })
})
