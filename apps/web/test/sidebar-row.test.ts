import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FeatureRow } from '../src/components/Sidebar'
import type { FeatureListItem } from '../src/lib/api'

/**
 * The rail's row as it renders (decision 10). Tier-1 static markup
 * (apps/web/STYLE.md): the row's whole job is the markup it emits, so the
 * assertions are on the string.
 *
 * What is being pinned here is the row's *anatomy* — a two-line clamp on the
 * title, exactly one status chip, the six-segment map, ticket progress only
 * when there are tickets, and no slug anywhere. Colours are otherwise left
 * alone; the one exception is the selected state, whose whole point is which
 * treatment it wears.
 */
function listItem(over: Partial<FeatureListItem> = {}): FeatureListItem {
  return {
    id: 'feat_1',
    projectId: 'proj_1',
    slug: 'flow-redesign-project-shell',
    title: 'Flow redesign: project shell and navigation',
    oneLiner: '',
    mapped: false,
    phase: 'tickets',
    branch: 'feature/flow-redesign-project-shell',
    baseBranch: 'main',
    status: 'active',
    createdAt: 0,
    ticketCounts: { total: 0, pending: 0, burning: 0, done: 0, failed: 0, cancelled: 0 },
    activeRun: false,
    liveSession: null,
    lastActivityAt: 0,
    ...over,
  } as FeatureListItem
}

function render(f: FeatureListItem, active = false): string {
  return renderToStaticMarkup(
    createElement(FeatureRow, { f, active, onSelect: () => undefined, actions: [] }),
  )
}

describe('sidebar feature row', () => {
  it('clamps the title to two lines and never prints the slug', () => {
    const html = render(listItem())

    expect(html).toContain('Flow redesign: project shell and navigation')
    expect(html).toContain('line-clamp-2')
    // The slug moved to the URL, the feature header and the kebab's Copy link.
    expect(html).not.toContain('flow-redesign-project-shell')
  })

  it('carries a phase dot and exactly one status chip', () => {
    const html = render(listItem({ phase: 'review' }))

    expect(html).toContain('bg-ph-review')
    // `rowChip` picked the age chip: nothing wants me, nothing is working.
    expect(html.match(/rounded-pill/g)).toHaveLength(1)
  })

  it('wears the parked glyph instead of a phase dot on a draft', () => {
    const html = render(listItem({ status: 'draft' }))

    expect(html).toContain('Draft')
    expect(html).not.toContain('bg-ph-tickets')
  })

  it('shows ticket progress only once the feature has tickets', () => {
    const without = render(listItem())
    const withTickets = render(
      listItem({
        ticketCounts: { total: 7, pending: 3, burning: 0, done: 4, failed: 0, cancelled: 0 },
      }),
    )

    expect(without).not.toContain('done<')
    expect(withTickets).toContain('4/7 done')
  })

  it('marks the selected row with a tint and a ring, never an accent bar', () => {
    const html = render(listItem(), true)

    // The same tint every other selected surface in the app wears — the pinned
    // project row above it, the settings rail's current tab, the run picker.
    expect(html).toContain('bg-accent-soft')
    expect(html).toContain('inset-ring-accent-line')
    // The violet left-border accent is gone. It was the only one in the app,
    // and an inset ring costs no layout, so unselected rows need no counterpart.
    expect(html).not.toContain('inset_2px')
  })

  it('leaves an unselected row untinted and unringed', () => {
    const html = render(listItem())

    expect(html).not.toContain('bg-accent-soft')
    expect(html).not.toContain('inset-ring')
  })

  it('renders the six-segment pipeline map with the current phase marked', () => {
    const html = render(listItem({ phase: 'tickets' }))

    const segments = html.match(/rounded-\[2px\] [a-z0-9- ]+"/g) ?? []
    // done · done · current · upcoming · upcoming · upcoming
    expect(segments).toHaveLength(6)
    expect(segments.filter((s) => s.endsWith('bg-text-4"'))).toHaveLength(2)
    expect(segments.filter((s) => s.endsWith('bg-accent"'))).toHaveLength(1)
    expect(segments.filter((s) => s.endsWith('bg-panel-3"'))).toHaveLength(3)
  })
})
