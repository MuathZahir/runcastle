import { describe, expect, it } from 'vitest'
import { sidebarLanes, triage } from '../src/lib/feature-ui'
import { listItem } from './fixtures'

/**
 * The sidebar's grouping (the-map-of-stories-and-scenarios decisions 2, 3):
 * what needs you lifted out, then the lanes the sidebar draws as the stopped
 * rows, the Working shelf and the Backlog / Shipped shelves. The split is pure.
 */

const ready = listItem({ id: 'ready', waitingReason: 'ready to test' })
const asking = listItem({ id: 'asking', liveSession: { status: 'live', awaitingInput: true }, leadAwaitsHuman: true })
const failed = listItem({
  id: 'failed',
  ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
})
const burning = listItem({ id: 'burning', activeRun: true })
const building = listItem({ id: 'building' })
const draft = listItem({ id: 'draft', status: 'draft' })
const shipped = listItem({ id: 'shipped', status: 'shipped' })
const archived = listItem({ id: 'archived', status: 'archived' })
const all = [ready, burning, draft, failed, asking, shipped, building, archived]

describe('sidebarLanes', () => {
  it('lifts exactly the Needs you features into the Inbox, in their incoming order', () => {
    const { inbox } = sidebarLanes(all)
    expect(inbox.map((f) => f.id)).toEqual(['ready', 'asking'])
  })

  it('keeps every other lane in today’s order, with no Needs you lane among them', () => {
    const { lanes } = sidebarLanes(all, { showArchived: true })
    expect(lanes.map((g) => g.key)).toEqual(['agentWorking', 'inProgress', 'drafts', 'shipped', 'archived'])
    expect(lanes.map((g) => g.features.map((f) => f.id))).toEqual([
      ['burning'],
      ['failed', 'building'],
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
