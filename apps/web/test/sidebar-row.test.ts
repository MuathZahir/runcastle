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

const waiting = listItem({ liveSession: { status: 'live', awaitingInput: true } as never })
const ready = listItem({ waitingReason: 'ready to test' })
const stopped = listItem({ waitingReason: 'stopped' })
const asked = listItem({ waitingReason: 'which retry policy should rounds use?' })
const failed = listItem({ ticketCounts: tickets(2, 1, 0, 1) })
const building = listItem({ activeRun: true, ticketCounts: tickets(8, 3, 1) })
const midTurn = listItem({ liveSession: { status: 'live', awaitingInput: false } as never })
const idle = listItem({ ticketCounts: tickets(6, 4) })

describe('featureStateWords', () => {
  it('says what a feature waiting on you waits for', () => {
    expect(featureStateWords(waiting)).toBe('Waiting on you')
    expect(featureStateWords(ready)).toBe('Ready to test')
    expect(featureStateWords(stopped)).toBe('Stopped')
    expect(featureStateWords(asked)).toBe('Which retry policy should rounds use?')
  })

  it('says an agent is at work, with the tickets landed out of those not cancelled while it builds', () => {
    expect(featureStateWords(building)).toBe('Working · 3/7')
    expect(featureStateWords(listItem({ activeRun: true }))).toBe('Working')
    expect(featureStateWords(midTurn)).toBe('Agent working')
  })

  it('says a started feature with nothing at work and nothing asked is in progress — a failed ticket included', () => {
    expect(featureStateWords(idle)).toBe('In progress')
    expect(featureStateWords(listItem({}))).toBe('In progress')
    expect(featureStateWords(failed)).toBe('In progress')
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
    expect(featureStateWords(listItem({ status: 'shipped' }))).toBe('Shipped')
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
    expect(html).toContain('In progress')
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

  it('becomes a card when selected', () => {
    expect(row(idle, { active: true })).toContain('aria-current="page"')
    expect(row(idle, { active: true })).toContain('ring-border-subtle')
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
