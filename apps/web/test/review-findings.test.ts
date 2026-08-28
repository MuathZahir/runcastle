import type { ReviewFinding } from '@runcastle/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FindingsSummaryBlock, OpenDefectsCard } from '../src/components/ReviewFindings'

/**
 * Review findings are fixed in-run, decisions #3 and #7 — what the human sees on
 * arrival at review. Rendered to static markup rather than driven through a DOM,
 * exactly as `lap-sections.test.ts` does: both blocks are hook-free by design
 * (the page reads the findings ONCE and hands them down), so their whole
 * behaviour is which rows they emit and which they leave out.
 */

const finding = (over: Partial<ReviewFinding> & { id: string }): ReviewFinding => ({
  featureId: 'f1',
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'high',
  title: 'the save drops the edited value',
  location: 'packages/server/src/save.ts:42',
  citation: 'spec.md §Save requires persistence',
  detail: 'The save action writes the row and then re-reads the stale copy.',
  reproStep: 'Edit a ticket title, save, reload — the old title is back.',
  status: 'open',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  createdAt: 1,
  ...over,
})

const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el)

describe('FindingsSummaryBlock', () => {
  it('leads with the computed counts line and lists the observations under it', () => {
    const html = render(
      createElement(FindingsSummaryBlock, {
        summary: { found: 2, fixed: 1, open: 1, observations: 1 },
        findings: [
          finding({ id: 'd1' }),
          finding({
            id: 'o1',
            kind: 'observation',
            severity: 'low',
            title: 'mobile was not verified',
          }),
        ],
      }),
    )

    expect(html).toContain('2 defects found · 1 fixed automatically · 1 still open · 1 observation')
    expect(html).toContain('mobile was not verified')
    // Observations are information under the digest, never rows in the list the
    // human has to clear — the defect's title stays out of this block.
    expect(html).not.toContain('the save drops the edited value')
  })

  it('renders nothing at all when the review reported nothing', () => {
    expect(
      render(
        createElement(FindingsSummaryBlock, {
          summary: { found: 0, fixed: 0, open: 0, observations: 0 },
          findings: [],
        }),
      ),
    ).toBe('')
    expect(render(createElement(FindingsSummaryBlock, { findings: [] }))).toBe('')
  })
})

describe('OpenDefectsCard', () => {
  const props = (open: ReviewFinding[], over: Record<string, unknown> = {}) => ({
    open,
    busy: false,
    readonly: false,
    onDismiss: () => {},
    ...over,
  })

  it('shows severity, the reason it is open, the detail and a Dismiss', () => {
    const html = render(
      createElement(
        OpenDefectsCard,
        props([
          finding({ id: 'd1', openReason: 'over-cap' }),
          finding({
            id: 'd2',
            severity: 'medium',
            title: 'the run chip goes grey',
            status: 'failed',
            openReason: 'fix-failed',
            failureReason: 'typecheck still red',
          }),
        ]),
      ),
    )

    expect(html).toContain('Open defects')
    expect(html).toContain('>high<')
    expect(html).toContain('>medium<')
    expect(html).toContain('over the auto-fix cap')
    expect(html).toContain('fix failed: typecheck still red')
    // The detail is present but behind a disclosure — the row itself is one line.
    expect(html).toContain('<details')
    expect(html).toContain('spec.md §Save requires persistence')
    expect(html).toContain('Dismiss')
  })

  it('renders nothing when nothing is open', () => {
    expect(render(createElement(OpenDefectsCard, props([])))).toBe('')
  })

  it('offers no Dismiss on a shipped feature’s review record', () => {
    const html = render(
      createElement(OpenDefectsCard, props([finding({ id: 'd1' })], { readonly: true })),
    )
    expect(html).toContain('the save drops the edited value')
    expect(html).not.toContain('Dismiss')
  })
})
