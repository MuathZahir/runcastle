import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FullAccounts } from '../src/components/review/FullAccounts'

/**
 * simplify-the-pages decision 6c: Full account keeps the lap write-up and the
 * work tickets' own accounts, and stops listing the review pass's digest — the
 * write-up is that account, and the trail's pass carries its one line.
 */
describe('FullAccounts', () => {
  const render = (): string =>
    renderToStaticMarkup(
      createElement(FullAccounts, {
        account: { source: 'review', prose: 'the lap landed the player rebuild' },
        tickets: [
          { seq: 1, title: 'rebuild the player', kind: 'implementation', lap: 2, digest: 'swapped the player out' },
          { seq: 2, title: 'Review', kind: 'review', lap: 2, digest: 'REVIEW PASS DIGEST' },
        ],
      }),
    )

  it('keeps the lap write-up and the work tickets’ digests', () => {
    const html = render()
    expect(html).toContain('the lap landed the player rebuild')
    expect(html).toContain('swapped the player out')
    expect(html).toContain('#1 rebuild the player')
  })

  it('does not list the review pass’s own digest', () => {
    const html = render()
    expect(html).not.toContain('REVIEW PASS DIGEST')
    expect(html).not.toContain('review pass')
  })
})
