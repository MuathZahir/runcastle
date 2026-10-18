import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { groupByRound } from '../src/lib/feature-ui'
import { RoundSections } from '../src/ui'

/**
 * The ticket ledger groups its rows by the round that ran them (decision 16).
 * Rendered to static markup: the whole of the component's behaviour is which
 * headers it emits and which are open.
 */
describe('RoundSections', () => {
  interface Row {
    seq: number
  }

  const render = (rows: Row[], rounds: { round: number; ticketSeqs: number[] }[]) =>
    renderToStaticMarkup(
      createElement(RoundSections<Row>, {
        groups: groupByRound(rows, rounds),
        meta: (g) => `${g.rows.length} rows`,
        children: (visible) => visible.map((r) => createElement('span', { key: r.seq }, `#${r.seq}`)),
      }),
    )

  it('renders a feature no round has run yet flat, with no header', () => {
    expect(render([{ seq: 1 }, { seq: 2 }], [])).toBe('<span>#1</span><span>#2</span>')
  })

  it('opens the latest round and the undispatched rows, and folds earlier rounds', () => {
    const html = render([{ seq: 1 }, { seq: 2 }, { seq: 3 }], [
      { round: 1, ticketSeqs: [1] },
      { round: 2, ticketSeqs: [2] },
    ])
    expect(html).toContain('Round 1')
    expect(html).toContain('Round 2')
    expect(html).toContain('Not yet dispatched')
    // Round 1 is the only folded one.
    expect(html.match(/<details/g)).toHaveLength(1)
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('Round 1'))
    expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('Round 2'))
  })
})
