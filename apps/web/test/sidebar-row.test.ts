import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FeatureRow } from '../src/components/Sidebar'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { FeatureListItem } from '../src/lib/api'

/**
 * The sidebar's feature row as it renders (DESIGN.md §Components: NavItem).
 * Tier-1 static markup (apps/web/STYLE.md): the row's whole job is the markup
 * it emits, so the assertions are on the string.
 *
 * What is pinned is the row's *anatomy* — one truncated line, the phase glyph,
 * at most one dot, ticket progress as a fraction, no slug, no chip, no mini
 * pipeline map, and a selected state that is a ground and nothing else.
 */
function listItem(over: Partial<FeatureListItem> = {}): FeatureListItem {
  return {
    id: 'feat_1',
    projectId: 'proj_1',
    slug: 'flow-redesign-project-shell',
    title: 'Flow redesign: project shell and navigation',
    oneLiner: '',
    mapped: false,
    phase: 'building',
    branch: 'feature/flow-redesign-project-shell',
    baseBranch: 'main',
    status: 'active',
    createdAt: 0,
    ticketCounts: { total: 0, pending: 0, burning: 0, done: 0, failed: 0, cancelled: 0 },
    lapTally: { landed: 0, total: 0, waived: 0 },
    activeRun: false,
    liveSession: null,
    lastActivityAt: 0,
    ...over,
  } as FeatureListItem
}

const copyLink: FeatureAction = { key: 'copy-link', label: 'Copy link', onSelect: () => undefined }

function render(f: FeatureListItem, active = false, actions: FeatureAction[] = []): string {
  return renderToStaticMarkup(createElement(FeatureRow, { f, active, onSelect: () => undefined, actions }))
}

describe('sidebar feature row', () => {
  it('is one truncated line that never prints the slug', () => {
    const html = render(listItem())

    expect(html).toContain('Flow redesign: project shell and navigation')
    expect(html).toContain('truncate')
    expect(html).not.toContain('line-clamp')
    // The slug lives in the URL, the feature page and the menu's Copy link.
    expect(html).not.toContain('flow-redesign-project-shell')
  })

  it('leads with the phase glyph, and the draft ring on a parked idea', () => {
    expect(render(listItem({ phase: 'review' }))).toContain('data-phase="review"')
    expect(render(listItem({ status: 'draft', phase: 'planning' }))).toContain('data-phase="draft"')
  })

  it('carries no chip, pill or pipeline map', () => {
    const html = render(listItem({ phase: 'review' }))

    expect(html).not.toContain('rounded-pill')
    expect(html).not.toContain('rounded-[2px]')
  })

  it('writes ticket progress as a fraction, only once there are tickets', () => {
    const without = render(listItem())
    const withTickets = render(listItem({ lapTally: { landed: 4, total: 7, waived: 0 } }))

    expect(without).not.toMatch(/\d+\/\d+/)
    expect(withTickets).toContain('>4/7<')
    expect(withTickets).not.toContain('done<')
  })

  it('breathes a live dot while an agent works, and an amber one when it needs you', () => {
    expect(render(listItem({ activeRun: true }))).toContain('animate-breathe')
    const waiting = render(listItem({ phase: 'review' }))
    expect(waiting).toContain('bg-warning')
    expect(waiting).toContain('test &amp; merge')
  })

  it('says a failure in danger rather than amber', () => {
    const html = render(
      listItem({ ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 } }),
    )

    expect(html).toContain('bg-danger')
  })

  it('marks the selected row with the selected ground and nothing else', () => {
    const html = render(listItem(), true)

    expect(html).toContain('bg-surface-selected')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('bg-accent-soft')
    expect(html).not.toContain('inset-ring')
  })

  it('reveals its menu on hover or focus, never at rest', () => {
    const html = render(listItem(), false, [copyLink])

    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover/nav:opacity-100')
  })

  // The "…" sits over the row's trailing edge: whatever lives there — the dot
  // alone, or the dot and a fraction — steps aside while the menu shows.
  const HIDES = [
    'group-hover/nav:opacity-0',
    'group-focus-within/nav:opacity-0',
    'group-has-[[aria-expanded=true]]/nav:opacity-0',
  ]
  /** Whether some `<span>` enclosing `inner` carries every hide-under-the-menu class. */
  const hiddenWhileMenuShows = (html: string, inner: string): boolean => {
    const tags = [...html.slice(0, html.indexOf(inner)).matchAll(/<span\b[^>]*>|<\/span>/g)].map((m) => m[0])
    const open: string[] = []
    for (const tag of tags) {
      if (tag === '</span>') open.pop()
      else open.push(tag)
    }
    return open.some((tag) => HIDES.every((c) => tag.includes(c)))
  }

  it('hides a lone status dot under the menu so the two never overlap', () => {
    const html = render(listItem({ phase: 'review' }), false, [copyLink])

    expect(html).toContain('bg-warning')
    expect(html).not.toMatch(/>\d+\/\d+</)
    expect(hiddenWhileMenuShows(html, 'bg-warning')).toBe(true)
  })

  it('hides the dot and the ticket fraction together under the menu', () => {
    const html = render(
      listItem({
        activeRun: true,
        lapTally: { landed: 0, total: 10, waived: 0 },
      }),
      false,
      [copyLink],
    )

    expect(html).toContain('>0/10<')
    expect(html).toContain('animate-breathe')
    expect(hiddenWhileMenuShows(html, 'animate-breathe')).toBe(true)
    expect(hiddenWhileMenuShows(html, '0/10')).toBe(true)
  })

  it('keeps the dot and fraction in view on a row with no menu', () => {
    const html = render(listItem({ lapTally: { landed: 2, total: 2, waived: 0 } }))

    expect(html).toContain('>2/2<')
    expect(html).not.toContain('group-hover/nav:opacity-0')
  })
})
