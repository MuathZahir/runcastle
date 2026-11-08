import { describe, expect, it } from 'vitest'
import { sidebarLanes, triage } from '../src/lib/feature-ui'
import { listItem, need } from './fixtures'

/**
 * The sidebar's grouping (the-map-of-stories-and-scenarios decisions 2, 3):
 * what needs you lifted out, then the lanes the sidebar draws as the stopped
 * rows, the Working shelf and the Backlog / Shipped shelves. The split is pure.
 */

const ready = listItem({ id: 'ready', need: need('test', 'Ready to test · Checkout') })
const asking = listItem({
  id: 'asking',
  liveSession: { status: 'live', awaitingInput: true },
  need: need('answer', 'Needs your answer'),
})
const failed = listItem({
  id: 'failed',
  ticketCounts: { total: 2, pending: 0, burning: 0, done: 1, failed: 1, cancelled: 0 },
})
const burning = listItem({ id: 'burning', workersWorking: 1 })
const building = listItem({ id: 'building' })
const draft = listItem({ id: 'draft', status: 'draft' })
const shipped = listItem({ id: 'shipped', status: 'shipped' })
const archived = listItem({ id: 'archived', status: 'archived' })
const all = [ready, burning, draft, failed, asking, shipped, building, archived]

describe('a lead that replied with work left running', () => {
  const session = { liveSession: { status: 'live' as const, awaitingInput: true } }

  it('sits under Agent working, not Needs you', () => {
    const f = listItem({ id: 'tests', ...session, leadInBackground: true })
    const { inbox, lanes } = sidebarLanes([f])
    expect(inbox).toEqual([])
    expect(lanes.map((g) => g.key)).toEqual(['agentWorking'])
  })

  it('needs you once it said so, whatever still runs', () => {
    const f = listItem({ id: 'tests', ...session, leadInBackground: true, need: need('plan', 'Plan to approve') })
    expect(sidebarLanes([f]).inbox.map((x) => x.id)).toEqual(['tests'])
  })
})

describe('a need its orchestrator holds (decision 18)', () => {
  it('sits under Agent working until its hour passes, then needs you', () => {
    const held = listItem({ id: 'held', need: need('plan', 'With the orchestrator · Plan to approve', { held: true }) })
    expect(sidebarLanes([held])).toEqual({ inbox: [], lanes: [{ key: 'agentWorking', label: 'Agent working', features: [held] }] })
    const due = listItem({ id: 'due', need: need('plan', 'Plan to approve') })
    expect(sidebarLanes([due]).inbox).toEqual([due])
  })

  it('a permission prompt during a round needs you, not Agent working', () => {
    const f = listItem({ id: 'asks', workersWorking: 1, need: need('permission', 'Needs permission · Bash: git push') })
    expect(sidebarLanes([f]).inbox).toEqual([f])
  })
})

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
