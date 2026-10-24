import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  featureStateWords,
  OrchestratorCard,
  Shelf,
  SidebarFeatureRow,
} from '../src/components/SidebarParts'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { FeatureListItem } from '../src/lib/api'
import { listItem } from './fixtures'

/**
 * The sidebar's pieces as they render (DESIGN.md §Frame, the project sidebar).
 * Tier-1 static markup (apps/web/STYLE.md): each piece is markup over resolved
 * values, so the assertions are on the string.
 *
 * What is pinned is the two-line row's *anatomy* — the title, then the phase
 * glyph, the state in words and the age; at most one dot; no slug — and the
 * row-level rules, so the `Sidebar` tests need not enumerate them.
 */

const tally = (landed: number, total: number) => ({ landed, total, waived: 0 })
const blocker = (slug: string) => ({
  featureId: `feat_${slug}`,
  slug,
  title: slug,
  phase: 'building' as const,
  status: 'active' as const,
  upNext: false,
  satisfied: false,
})

const waiting = listItem({ phase: 'building', liveSession: { status: 'live', awaitingInput: true } as never })
const failed = listItem({
  phase: 'building',
  ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
})
const review = listItem({ phase: 'review' })
const ticketsReady = listItem({
  phase: 'planning',
  ticketCounts: { total: 3, pending: 3, burning: 0, done: 0, failed: 0, cancelled: 0 },
})
const building = listItem({ phase: 'building', activeRun: true, lapTally: tally(3, 7) })
const midTurn = listItem({ phase: 'building', liveSession: { status: 'live', awaitingInput: false } as never })
const stopped = listItem({ phase: 'building', lapTally: tally(4, 6) })

describe('featureStateWords', () => {
  it('says what a feature waiting on you waits for', () => {
    expect(featureStateWords(waiting)).toBe('Waiting on you')
    expect(featureStateWords(failed)).toBe('Run failed')
    expect(featureStateWords(review)).toBe('Ready to test')
    expect(featureStateWords(ticketsReady)).toBe('Tickets ready')
  })

  it('says an agent is at work, with the lap’s progress while it builds', () => {
    expect(featureStateWords(building)).toBe('Building · 3/7')
    expect(featureStateWords(listItem({ phase: 'building', activeRun: true }))).toBe('Building')
    expect(featureStateWords(midTurn)).toBe('Agent working')
  })

  it('says a started feature with nothing at work has stopped', () => {
    expect(featureStateWords(stopped)).toBe('Stopped · 4/6')
    expect(featureStateWords(listItem({ phase: 'building' }))).toBe('Stopped')
  })

  it('puts a parked idea in the backlog, or says what it waits on', () => {
    expect(featureStateWords(listItem({ status: 'draft' }))).toBe('In the backlog')
    expect(featureStateWords(listItem({ status: 'draft', dependsOn: [blocker('auth')] }))).toBe('Blocked by auth')
  })

  it('says what an Up next feature starts after, and when one cannot start by itself', () => {
    expect(featureStateWords(listItem({ status: 'draft', upNext: true, dependsOn: [blocker('auth')] }))).toBe(
      'After auth',
    )
    expect(featureStateWords(listItem({ status: 'draft', upNext: true }))).toBe("Won't start by itself")
  })

  it('says shipped and archived plainly', () => {
    expect(featureStateWords(listItem({ status: 'shipped', phase: 'shipped' }))).toBe('Shipped')
    expect(featureStateWords(listItem({ status: 'archived' }))).toBe('Archived')
  })
})

const copyLink: FeatureAction = { key: 'copy-link', label: 'Copy link', onSelect: () => undefined }

function row(f: FeatureListItem, over: { active?: boolean; actions?: FeatureAction[] } = {}): string {
  return renderToStaticMarkup(
    createElement(SidebarFeatureRow, {
      f: { ...f, title: 'Flow redesign: project shell', slug: 'flow-redesign-project-shell' },
      active: over.active ?? false,
      onSelect: () => undefined,
      actions: over.actions ?? [],
    }),
  )
}

describe('the sidebar feature row', () => {
  it('is a title over the phase glyph, the state in words and the age — never the slug', () => {
    const html = row(stopped)
    expect(html).toContain('Flow redesign: project shell')
    expect(html).toContain('data-phase="building"')
    expect(html).toContain('Stopped · 4/6')
    expect(html).not.toContain('flow-redesign-project-shell')
  })

  it('wears the draft ring on a parked idea', () => {
    expect(row(listItem({ status: 'draft' }))).toContain('data-phase="draft"')
  })

  it('says on hover that an Up next feature starts by itself', () => {
    expect(row(listItem({ status: 'draft', upNext: true, dependsOn: [blocker('auth')] }))).toContain(
      'title="Flow redesign: project shell — starts by itself when auth ships"',
    )
  })

  it('dots amber when it waits on you, red with red words when a run failed, grey when stopped', () => {
    expect(row(waiting)).toContain('bg-warning')
    expect(row(failed)).toContain('bg-danger')
    expect(row(failed)).toContain('text-danger-text')
    expect(row(stopped)).toContain('bg-icon')
  })

  it('carries no dot while an agent works — its words shimmer instead', () => {
    const html = row(building)
    expect(html).toContain('text-shimmer')
    expect(html).not.toContain('bg-warning')
    expect(row(stopped)).not.toContain('text-shimmer')
  })

  it('becomes a card when selected', () => {
    expect(row(stopped, { active: true })).toContain('aria-current="page"')
    expect(row(stopped, { active: true })).toContain('ring-border-subtle')
    expect(row(stopped)).not.toContain('aria-current')
  })

  it('reveals its menu on hover or focus, never at rest', () => {
    const html = row(stopped, { actions: [copyLink] })
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover/nav:opacity-100')
  })
})

describe('a shelf', () => {
  const features = Array.from({ length: 7 }, (_, i) =>
    listItem({ id: `s${i}`, status: 'shipped', phase: 'shipped' }),
  )
  const shelf = (open: boolean) =>
    renderToStaticMarkup(
      createElement(Shelf, {
        icon: null,
        label: 'Shipped',
        features,
        renderRow: (f: FeatureListItem) => createElement('i', { key: f.id }, f.id),
        cap: 5,
        open,
      }),
    )

  it('folded, shows its name and count but no rows', () => {
    const html = shelf(false)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>Shipped<')
    expect(html).toContain('>7<')
    expect(html).not.toContain('<i>')
  })

  it('opened past its cap, shows that many and then "Show N more"', () => {
    const html = shelf(true)
    expect(html.match(/<i>/g)).toHaveLength(5)
    expect(html).toContain('Show 2 more')
  })
})

describe('the Orchestrator card', () => {
  const card = (waiting: boolean) =>
    renderToStaticMarkup(
      createElement(OrchestratorCard, {
        status: 'Waiting on you · 2 notes',
        waiting,
        active: false,
        onOpen: () => undefined,
        actions: [],
      }),
    )

  it('names itself and says what it holds', () => {
    expect(card(false)).toContain('Orchestrator')
    expect(card(false)).toContain('Waiting on you · 2 notes')
  })

  it('dots amber only while the chat waits on you', () => {
    expect(card(true)).toContain('bg-warning')
    expect(card(false)).not.toContain('bg-warning')
  })
})
