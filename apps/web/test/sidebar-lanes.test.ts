import { describe, expect, it } from 'vitest'
import { sidebarLanes, triage } from '../src/lib/feature-ui'
import { listItem, need } from './fixtures'

/**
 * The sidebar's grouping (the-map-of-stories-and-scenarios decisions 2, 3;
 * needs-you-is-the-agent-s-call decisions 15, 18): what needs you lifted out,
 * then Working, Idle and the shelves. The split is pure.
 */

const ready = listItem({ id: 'ready', need: need('Ready to test · Checkout') })
const asking = listItem({ id: 'asking', need: need('Which retry policy?') })
const failed = listItem({
  id: 'failed',
  ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
})
const burning = listItem({ id: 'burning', workersWorking: 1, working: true })
const building = listItem({ id: 'building' })
const draft = listItem({ id: 'draft', status: 'draft' })
const shipped = listItem({ id: 'shipped', status: 'shipped' })
const archived = listItem({ id: 'archived', status: 'archived' })
const all = [ready, burning, draft, failed, asking, shipped, building, archived]

describe('a lead that replied with work left running', () => {
  it('sits under Working, not Needs you', () => {
    const f = listItem({ id: 'tests', working: true })
    const { inbox, lanes } = sidebarLanes([f])
    expect(inbox).toEqual([])
    expect(lanes).toEqual([{ key: 'working', label: 'Working', features: [f] }])
  })

  it('needs you once it said so, whatever still runs (decision 18)', () => {
    const f = listItem({ id: 'tests', working: true, workersWorking: 1, need: need('Plan ready for your yes') })
    expect(sidebarLanes([f]).inbox.map((x) => x.id)).toEqual(['tests'])
  })
})

describe('sidebarLanes', () => {
  it('lifts exactly the Needs you features into the Inbox, in their incoming order', () => {
    const { inbox } = sidebarLanes(all)
    expect(inbox.map((f) => f.id)).toEqual(['ready', 'asking'])
  })

  it('keeps every other lane in order, with no Needs you lane among them', () => {
    const { lanes } = sidebarLanes(all, { showArchived: true })
    expect(lanes.map((g) => g.key)).toEqual(['working', 'idle', 'drafts', 'shipped', 'archived'])
    expect(lanes.map((g) => g.label)).toEqual(['Working', 'Idle', 'Backlog', 'Shipped', 'Archived'])
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
    expect(lanes.map((g) => g.key)).toEqual(['working', 'drafts'])
  })
})
