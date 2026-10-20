import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sidebarLanes, triage } from '../src/lib/feature-ui'
import { InboxLane } from '../src/components/SidebarLanes'
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
