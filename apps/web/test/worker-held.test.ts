import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkerRow } from '@runcastle/core'
import { SidebarWorkerItem } from '../src/components/SidebarParts'
import { WorkerStatusLine } from '../src/components/workers/WorkerParts'
import { workerEntry, workerStatusWhy } from '../src/lib/workers'

/**
 * A queued worker held by an account error (burns-become-workers decision 21)
 * says why, in its row of the feature's worker list and in its chat's status
 * line: "Queued · held: <reason>". Tier 1: the words are the behaviour.
 */

const HOLD = 'It failed on the account, so no queued worker on claude-code starts until the human next writes to a lead or a worker.'

const wire = (over: Partial<WorkerRow> & { heldBy?: string | null } = {}) => ({
  id: 'w_list',
  label: 'Thread list',
  purpose: 'The sidebar thread list',
  kind: 'on-its-own' as const,
  goal: null,
  doneWhen: null,
  model: 'claude-opus-5-5',
  startedBy: 'lead' as const,
  status: 'queued' as const,
  failure: null,
  createdAt: 1,
  updatedAt: 0,
  ...over,
})

const rowMarkup = (w: ReturnType<typeof wire>) =>
  renderToStaticMarkup(createElement(SidebarWorkerItem, { worker: workerEntry(w), active: false, onSelect: () => {}, actions: [] }))

const statusMarkup = (w: ReturnType<typeof wire>) => {
  const why = workerStatusWhy(w)
  return renderToStaticMarkup(createElement(WorkerStatusLine, { status: w.status, ...(why ? { why } : {}) }))
}

describe('a queued worker held by an account error', () => {
  it('shows the hold’s reason in its row and in its chat’s status line', () => {
    const held = wire({ heldBy: HOLD })
    expect(rowMarkup(held)).toContain(`Queued · held: ${HOLD}`)
    expect(statusMarkup(held)).toContain('Queued')
    expect(statusMarkup(held)).toContain(`· held: ${HOLD}`)
  })

  it('reads as plain Queued when nothing holds it, and a hold says nothing once the worker runs', () => {
    expect(rowMarkup(wire())).toContain('>Queued<')
    expect(rowMarkup(wire())).not.toContain('held')
    const running = wire({ status: 'working', heldBy: HOLD })
    expect(rowMarkup(running)).not.toContain('held')
    expect(statusMarkup(running)).not.toContain('held')
  })
})
