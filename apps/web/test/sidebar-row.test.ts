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
    dependsOn: [],
    blocks: [],
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

  it('says what a waiting draft waits on, with each blocker and its state on hover (ADR-0013)', () => {
    const blocker = (slug: string, over: Partial<FeatureListItem['dependsOn'][number]> = {}) => ({
      featureId: `feat_${slug}`,
      slug,
      title: slug,
      phase: 'building' as const,
      status: 'active' as const,
      satisfied: false,
      ...over,
    })
    const one = render(listItem({ status: 'draft', phase: 'planning', dependsOn: [blocker('weekly-digest')] }))
    const two = render(
      listItem({
        status: 'draft',
        phase: 'planning',
        dependsOn: [blocker('auth'), blocker('old', { status: 'archived', phase: 'planning' })],
      }),
    )
    const ready = render(
      listItem({
        status: 'draft',
        phase: 'planning',
        dependsOn: [blocker('done', { status: 'shipped', phase: 'shipped', satisfied: true })],
      }),
    )

    expect(one).toContain('>Waits on weekly-digest<')
    expect(one).toContain('waits on weekly-digest (building)')
    expect(two).toContain('>Waits on 2<')
    expect(two).toContain('waits on auth (building), old (archived)')
    expect(ready).not.toContain('Waits on')
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

  // Lap 1 drive: the tag sat after the title in the label, and on a waiting
  // draft the meta took the rest of the row — the title shrank to nothing and
  // the tag clipped to "Orch" before "Waits on snake-powerups".
  it('gives a waiting orchestrated draft its whole label for the title, beside its Waits on meta', () => {
    const html = render(
      listItem({
        title: 'Snake power-ups',
        status: 'draft',
        phase: 'planning',
        orchestrated: true,
        dependsOn: [
          {
            featureId: 'feat_core',
            slug: 'snake-powerups',
            title: 'snake-powerups',
            phase: 'building',
            status: 'active',
            satisfied: false,
          },
        ],
      }),
    )

    expect(html).toContain('<span class="min-w-0 flex-auto truncate">Snake power-ups</span>')
    expect(html).toContain('>Waits on snake-powerups<')
    expect(html).not.toContain('bg-accent-subtle')
  })

  // Lap 2 review: with the tag gone the title still read "See…" (34 of 169 px)
  // beside "Waits on changelog-file", whose wrapper never shrank. Static markup
  // cannot measure, so what is pinned is the flex sizing that shares the
  // shortfall: the label is sized from its text (not a zero basis that lets the
  // meta take everything first), and the meta's cluster may shrink and truncate.
  it('lets a long Waits on meta give up width alongside the title instead of taking it', () => {
    const html = render(
      listItem({
        title: 'See changelog README line',
        status: 'draft',
        phase: 'planning',
        orchestrated: true,
        dependsOn: [
          {
            featureId: 'feat_changelog',
            slug: 'changelog-file',
            title: 'changelog-file',
            phase: 'building',
            status: 'active',
            satisfied: false,
          },
        ],
      }),
    )

    expect(html).toContain('<span class="min-w-0 flex-auto truncate">See changelog README line</span>')
    expect(html).not.toContain('shrink-0 items-center gap-2')
    expect(html).toContain('<span class="flex min-w-0 items-center gap-2">')
    expect(html).toMatch(/<span class="min-w-0 truncate [^"]*">Waits on changelog-file<\/span>/)
  })

  it('rings the glyph of a feature the orchestrator owns, named Orchestrated, and no other', () => {
    const owned = render(listItem({ orchestrated: true }))
    expect(owned).toContain('data-glyph-ring')
    expect(owned).toContain('ring-accent')
    expect(owned).toContain('aria-label="Orchestrated"')
    // No text tag in the row: the label is the title alone.
    expect(owned).toContain('<span class="min-w-0 flex-auto truncate">Flow redesign: project shell and navigation</span>')
    expect(owned).not.toContain('>Orchestrated<')

    for (const html of [render(listItem({ orchestrated: false })), render(listItem())]) {
      expect(html).not.toContain('Orchestrated')
      expect(html).not.toContain('data-glyph-ring')
      expect(html).not.toContain('ring-accent')
    }
  })
})
