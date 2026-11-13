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
import { listItem, need } from './fixtures'

/**
 * The sidebar's pieces as they render (DESIGN.md §Frame, the project sidebar).
 * Tier-1 static markup (apps/web/STYLE.md): each piece is markup over resolved
 * values, so the assertions are on the string.
 *
 * What is pinned is the two-line row's *anatomy* — the title, then the progress
 * glyph, the state in words and the age; at most one dot; no slug — and the
 * row-level rules, so the `Sidebar` tests need not enumerate them.
 */

const tickets = (total: number, done: number, cancelled = 0, failed = 0) => ({
  total,
  pending: total - done - cancelled - failed,
  burning: 0,
  done,
  failed,
  cancelled,
})
const blocker = (slug: string) => ({
  featureId: `feat_${slug}`,
  slug,
  title: slug,
  status: 'active' as const,
  upNext: false,
  satisfied: false,
})

const waiting = listItem({ need: need('Which retry policy?') })
const ready = listItem({ need: need('Ready to test · Checkout') })
const asksWhileWorking = listItem({ working: true, workersWorking: 1, need: need('May I push?') })
const failed = listItem({ ticketCounts: tickets(2, 1, 0, 1) })
const building = listItem({ working: true, workersWorking: 2, ticketCounts: tickets(8, 3, 1) })
const idle = listItem({ ticketCounts: tickets(6, 4) })

describe('featureStateWords (needs-you-is-the-agent-s-call decision 15)', () => {
  it('says Needs you with the agent’s own line', () => {
    expect(featureStateWords(waiting)).toBe('Needs you · Which retry policy?')
    expect(featureStateWords(ready)).toBe('Needs you · Ready to test · Checkout')
  })

  it('says Needs you over Working (decision 18)', () => {
    expect(featureStateWords(asksWhileWorking)).toBe('Needs you · May I push?')
  })

  it('says Working while the server says an agent works', () => {
    expect(featureStateWords(building)).toBe('Working')
  })

  it('says Idle when nothing works and nothing is asked — a failed ticket included', () => {
    expect(featureStateWords(idle)).toBe('Idle')
    expect(featureStateWords(listItem({}))).toBe('Idle')
    expect(featureStateWords(failed)).toBe('Idle')
  })

  it('puts a parked idea in the backlog, or says what it waits on', () => {
    expect(featureStateWords(listItem({ status: 'draft' }))).toBe('In the backlog')
    expect(featureStateWords(listItem({ status: 'draft', dependsOn: [blocker('auth')] }))).toBe('Blocked by auth')
  })

  it('says what an Up next feature starts after, and when one cannot start by itself', () => {
    expect(featureStateWords(listItem({ status: 'draft', upNext: true, dependsOn: [blocker('auth')] }))).toBe(
      'After auth',
    )
  })

  it('says an Up next feature’s problem when it cannot start by itself (decision 16)', () => {
    expect(featureStateWords(listItem({ status: 'draft', upNext: true, upNextProblem: 'auth was dropped' }))).toBe(
      'auth was dropped',
    )
  })

  it('says merged and archived plainly', () => {
    expect(featureStateWords(listItem({ status: 'shipped' }))).toBe('Merged')
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
  it('is a title over the progress glyph, the state in words and the age — never the slug', () => {
    const html = row(idle)
    expect(html).toContain('Flow redesign: project shell')
    expect(html).toContain('aria-label="67% landed"')
    expect(html).toContain('Idle')
    expect(html).not.toContain('data-phase')
    expect(html).not.toContain('flow-redesign-project-shell')
  })

  it('pies the share of tickets landed, leaving cancelled ones out', () => {
    expect(row(building)).toContain('aria-label="43% landed"')
    expect(row(listItem({}))).toContain('aria-label="0% landed"')
  })

  it('wears the dashed ring on a parked idea and the check once shipped', () => {
    expect(row(listItem({ status: 'draft' }))).toContain('aria-label="Backlog"')
    expect(row(listItem({ status: 'shipped', ticketCounts: tickets(3, 3) }))).toContain('aria-label="Shipped"')
  })

  it('says on hover that an Up next feature starts by itself', () => {
    expect(row(listItem({ status: 'draft', upNext: true, dependsOn: [blocker('auth')] }))).toContain(
      'title="Flow redesign: project shell — starts by itself when auth ships"',
    )
  })

  it('dots amber when it needs you, and carries no dot otherwise — not even for a failed ticket', () => {
    expect(row(waiting)).toContain('bg-warning')
    expect(row(ready)).toContain('bg-warning')
    for (const f of [failed, idle]) {
      const html = row(f)
      expect(html).not.toContain('bg-warning')
      expect(html).not.toContain('bg-danger')
      expect(html).not.toContain('text-danger')
      expect(html).not.toContain('bg-icon')
    }
  })

  it('carries no dot while an agent works — its words shimmer instead', () => {
    const html = row(building)
    expect(html).toContain('text-shimmer')
    expect(html).not.toContain('bg-warning')
    expect(row(idle)).not.toContain('text-shimmer')
  })

  it('says an Up next draft’s problem in red, with no amber dot (decision 16)', () => {
    const html = row(listItem({ status: 'draft', upNext: true, upNextProblem: 'auth was dropped' }))
    expect(html).toContain('auth was dropped')
    expect(html).toContain('text-danger-text')
    expect(html).not.toContain('bg-warning')
  })

  it('becomes a card when selected', () => {
    expect(row(idle, { active: true })).toContain('aria-current="page"')
    expect(row(idle, { active: true })).toMatch(/class="[^"]*\bcard\b/)
    expect(row(idle)).not.toContain('aria-current')
  })

  it('reveals its menu on hover or focus, never at rest', () => {
    const html = row(idle, { actions: [copyLink] })
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover/nav:opacity-100')
  })
})

describe('a shelf', () => {
  const features = Array.from({ length: 7 }, (_, i) =>
    listItem({ id: `s${i}`, status: 'shipped' }),
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
        status: 'Waiting for you · 2 notes',
        state: waiting ? 'waiting' : 'idle',
        active: false,
        onOpen: () => undefined,
        actions: [],
      }),
    )

  it('names itself and says what it holds', () => {
    expect(card(false)).toContain('Epics')
    expect(card(false)).toContain('Waiting for you · 2 notes')
  })

  it('dots amber only while the chat waits on you', () => {
    expect(card(true)).toContain('bg-warning')
    expect(card(false)).not.toContain('bg-warning')
  })
})
