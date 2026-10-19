import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAP_UNGROUPED } from '@runcastle/core'
import { sidebarLanes, triage } from '../src/lib/feature-ui'
import { InboxLane, MapTree } from '../src/components/SidebarLanes'
import { listItem } from './fixtures'

/**
 * The sidebar's Inbox | lanes split and the Map tree (the-map-of-stories-and-
 * scenarios decisions 2, 3). The split is pure; the Inbox and the tree are
 * tier-1 markup (apps/web/STYLE.md).
 */

const waiting = listItem({ id: 'review', phase: 'review' })
const failed = listItem({
  id: 'failed',
  phase: 'building',
  ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
})
const burning = listItem({ id: 'burning', phase: 'building', activeRun: true })
const building = listItem({ id: 'building', phase: 'building' })
const draft = listItem({ id: 'draft', status: 'draft' })
const shipped = listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' })
const archived = listItem({ id: 'archived', status: 'archived' })
const all = [waiting, burning, draft, failed, shipped, building, archived]

describe('sidebarLanes', () => {
  it('lifts exactly the Needs you features into the Inbox, in their incoming order', () => {
    const { inbox } = sidebarLanes(all)
    expect(inbox.map((f) => f.id)).toEqual(['review', 'failed'])
  })

  it('keeps every other lane in today’s order, with no Needs you lane among them', () => {
    const { lanes } = sidebarLanes(all, { showArchived: true })
    expect(lanes.map((g) => g.key)).toEqual(['agentWorking', 'inProgress', 'drafts', 'shipped', 'archived'])
    expect(lanes.map((g) => g.features.map((f) => f.id))).toEqual([
      ['burning'],
      ['building'],
      ['draft'],
      ['shipped'],
      ['archived'],
    ])
  })

  it('is the triage with its first lane taken out', () => {
    const groups = triage(all)
    const { inbox, lanes } = sidebarLanes(all)
    expect(groups[0]?.features).toEqual(inbox)
    expect(groups.slice(1)).toEqual(lanes)
  })

  it('gives an empty Inbox when nothing waits on the human', () => {
    const { inbox, lanes } = sidebarLanes([burning, draft])
    expect(inbox).toEqual([])
    expect(lanes.map((g) => g.key)).toEqual(['agentWorking', 'drafts'])
  })
})

describe('InboxLane', () => {
  const render = (features: typeof all) =>
    renderToStaticMarkup(
      createElement(InboxLane, { features, renderRow: (f) => createElement('i', { key: f.id }, f.id) }),
    )

  it('renders its waiting rows under an Inbox label', () => {
    const html = render([waiting, failed])
    expect(html).toContain('aria-label="Inbox"')
    expect(html).toContain('<i>review</i><i>failed</i>')
    expect(html).not.toContain('Nothing needs you')
  })

  it('shrinks to one quiet row when empty', () => {
    const html = render([])
    expect(html).toContain('Nothing needs you')
    expect(html).not.toContain('<i>')
  })
})

describe('MapTree', () => {
  const groups = [
    { id: 'auth', name: 'Auth' },
    { id: 'checkout', name: 'Checkout' },
    { id: 'checkout/coupons', name: 'Coupons', parentId: 'checkout' },
    { id: MAP_UNGROUPED, name: 'Ungrouped' },
  ]
  const render = (selection: string | null | undefined) =>
    renderToStaticMarkup(createElement(MapTree, { groups, selection, onOpen: () => undefined }))
  /** The row (its outer div) that holds a label. */
  const row = (html: string, label: string) => {
    const at = html.indexOf(`>${label}<`)
    const start = html.lastIndexOf('<div class="group/nav', at)
    return html.slice(start, html.indexOf('>', start))
  }

  it('lists Overview, then the groups in order, Ungrouped last', () => {
    const html = render(undefined)
    const order = ['Overview', 'Auth', 'Checkout', 'Coupons', 'Ungrouped'].map((l) => html.indexOf(`>${l}<`))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('indents a level-2 group under its parent and quiets Ungrouped', () => {
    const html = render(undefined)
    expect(row(html, 'Coupons')).toContain('ml-4')
    expect(row(html, 'Checkout')).not.toContain('ml-4')
    expect(row(html, 'Ungrouped')).toContain('h-7')
  })

  it('highlights the open address: the Overview at null, a group by its id', () => {
    expect(row(render(null), 'Overview')).toContain('bg-surface-selected')
    const html = render('checkout/coupons')
    expect(row(html, 'Coupons')).toContain('bg-surface-selected')
    expect(row(html, 'Overview')).not.toContain('bg-surface-selected')
    expect(render(undefined)).not.toContain('bg-surface-selected')
  })
})
