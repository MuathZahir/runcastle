import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { listAfter as listEvents } from '../src/services/events'
import { storeTickets, updateTicket } from './helpers/tickets'
import { holdUpgradeNotes, UPGRADE_NOTE_EVENT } from '../src/services/upgrade-note'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, type AgentHost } from '../src/threads/types'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/** Tickets are frozen history; a lead with unfinished ones is told once, on its next message (decision 20). */

let ctx: AppCtx
let projectId: string
let host: AgentHost
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  restoreDataDir()
})

function lead(featureId: string): string {
  const row = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  appendThreadEvent(row.id, { type: 'prompt', id: `p-${row.id}`, text: 'hi', source: 'human' })
  return row.id
}

const input = (title: string) => ({ title, goal: `goal of ${title}`, context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] })

describe('the ticket upgrade note', () => {
  it('is held once for each active feature with unfinished tickets, and wakes nothing', async () => {
    const open = seedFeature(ctx, projectId, { slug: 'open' })
    const finished = seedFeature(ctx, projectId, { slug: 'finished' })
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' })
    const openLead = lead(open.id)
    const finishedLead = lead(finished.id)
    const shippedLead = lead(shipped.id)
    const [a, b] = storeTickets(ctx, open.id, [input('Alpha'), input('Beta')])
    updateTicket(ctx, b.id, { status: 'done' })
    const [c] = storeTickets(ctx, finished.id, [input('Gamma')])
    updateTicket(ctx, c.id, { status: 'cancelled' })
    storeTickets(ctx, shipped.id, [input('Delta')])

    expect(await holdUpgradeNotes(ctx)).toBe(1)
    expect(await holdUpgradeNotes(ctx)).toBe(0)

    const held = promptsOf(openLead).filter((p) => p.held)
    expect(held).toHaveLength(1)
    expect(held[0]?.text).toContain(`#${a.seq} Alpha`)
    expect(held[0]?.text).toContain('goal of Alpha')
    expect(held[0]?.text).not.toContain('Beta')
    expect(promptsOf(openLead).filter((p) => !p.held && p.source === 'runcastle')).toHaveLength(0)
    expect(promptsOf(finishedLead).filter((p) => p.held)).toHaveLength(0)
    expect(promptsOf(shippedLead).filter((p) => p.held)).toHaveLength(0)
    expect(listEvents(ctx, open.id).filter((e) => e.type === UPGRADE_NOTE_EVENT)).toHaveLength(1)
  })
})
