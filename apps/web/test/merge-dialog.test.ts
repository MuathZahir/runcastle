import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MergeConfirmation } from '../src/components/MergeFeatureDialog'
import { mergeSummary } from '../src/lib/feature-ui'
import type { Freshness } from '../src/lib/feature-ui'

/**
 * The last door's content (decisions 29 and 31). Tier 1: the Dialog primitive's
 * own mechanics — Escape, backdrop dismissal, focus return — are covered by
 * `dialog.test.tsx`, so what is asserted here is what this dialog SAYS and which
 * button it makes the primary.
 */
const FRESH: Freshness = { tone: 'fresh', text: 'Reviewed ✓ · this build' }

const summary = (over: Partial<Parameters<typeof mergeSummary>[0]> = {}) =>
  mergeSummary({
    branch: 'feature/greetings-pages',
    base: 'main',
    delta: { commits: 12, files: 9 },
    tickets: [{ kind: 'implementation', status: 'done', lap: 1 }],
    lap: 1,
    driveTaken: true,
    freshness: FRESH,
    ...over,
  })

const render = (props: Partial<Parameters<typeof MergeConfirmation>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(MergeConfirmation, {
      title: 'Greetings pages',
      branch: 'feature/greetings-pages',
      base: 'main',
      summary: summary(),
      busy: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  )

const CONFLICT = { base: 'main', files: ['index.html'], at: 1 }

describe('MergeFeatureDialog', () => {
  describe('the green case', () => {
    it('is read-to-confirm: no typing to arm, one primary that merges', () => {
      const html = render()
      expect(html).toContain('Merge &amp; ship')
      expect(html).not.toContain('<input')
      expect(html).not.toContain('disabled=""')
    })

    it('states what lands, row by row', () => {
      const html = render()
      expect(html).toContain('What lands')
      expect(html).toContain('12 commits · 9 files')
      expect(html).toContain('1/1 tickets done')
      expect(html).toContain('taken')
      expect(html).toContain('Reviewed ✓ · this build')
    })

    it('says what the button will actually do', () => {
      expect(render()).toContain(
        'Merges feature/greetings-pages into main, writes the outcome doc, and moves the feature to Shipped.',
      )
    })

    it('enumerates the warnings box when there is something to ship over', () => {
      const html = render({ summary: summary({ openNotes: 2, driveTaken: false }) })
      expect(html).toContain('2 open test-drive notes.')
      expect(html).toContain('never test-driven')
    })

    it('offers no resolve control when nothing is conflicted', () => {
      expect(render()).not.toContain('Resolve the merge conflict')
    })
  })

  /**
   * The walked bug (decision 29): over a standing conflict the bar flipped its
   * primary to Resolve, and Merge & ship opened this same all-green dialog —
   * so a human who read only the dialog saw green over a branch that would
   * re-conflict.
   */
  describe('over a standing merge conflict', () => {
    const conflicted = {
      summary: summary({ conflict: CONFLICT }),
      onResolve: () => undefined,
    }

    it('tops what lands with the red row, above the green rows', () => {
      const html = render(conflicted)
      expect(html).toContain('A merge conflict is standing (index.html)')
      expect(html.indexOf('merge conflict is standing')).toBeLessThan(
        html.indexOf('12 commits · 9 files'),
      )
    })

    it('flips the primary to resolving the conflict', () => {
      expect(render(conflicted)).toContain('Resolve the merge conflict')
    })

    it('keeps merging reachable as an enabled secondary, honestly labelled', () => {
      const html = render(conflicted)
      expect(html).toContain('Retry merge anyway')
      expect(html).toContain('if you resolved it by hand, retry lands it')
      // Nothing is disabled: fix-merge-conflict-system decisions 2b/3 — the
      // conflict probe is best-effort, and a hand-resolved merge must still land.
      expect(html).not.toContain('disabled=""')
    })

    it('still shows what lands if it lands', () => {
      expect(render(conflicted)).toContain('12 commits · 9 files')
    })

    it('keeps the plain primary when the caller offers no resolve act', () => {
      const html = render({ summary: summary({ conflict: CONFLICT }) })
      expect(html).toContain('A merge conflict is standing')
      expect(html).toContain('Merge &amp; ship')
      expect(html).not.toContain('Retry merge anyway')
    })
  })
})
