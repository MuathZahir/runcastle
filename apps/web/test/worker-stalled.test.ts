import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Need, WorkerRow, WorkerStatus as CoreWorkerStatus } from '@runcastle/core'
import { SidebarWorkerItem } from '../src/components/SidebarParts'
import { WorkerFailedCard, WorkerStatusLine } from '../src/components/workers/WorkerParts'
import {
  shownWorkerStatus,
  WORKER_STALLED_WHY,
  WORKER_STATUS_TONE,
  WORKER_STATUS_WORDS,
  workerCanHandBack,
  workerEntry,
  workerGroups,
  workersNeedYou,
  workerStatusWhy,
} from '../src/lib/workers'
import { need } from './fixtures'

/**
 * A worker that stopped twice without handing back reads Stalled
 * (a-worker-never-shows-working-with-nothing-running decisions 1, 5, 6): never
 * Working with nothing running, never "needs you", amber where it shows, and
 * its notice in the lead's chat. Tier 1: the words are the behaviour.
 */

const wire = (over: Partial<WorkerRow> & { need?: Need | null; turnRunning?: boolean } = {}) => ({
  id: 'w_list',
  label: 'Thread list',
  purpose: 'The sidebar thread list',
  kind: 'on-its-own' as const,
  goal: null,
  doneWhen: null,
  model: 'claude-opus-5-5',
  startedBy: 'lead' as const,
  status: 'stalled' as CoreWorkerStatus,
  failure: null,
  createdAt: 1,
  updatedAt: 0,
  ...over,
})

const NEED = need('Back arrow or chevron?')

describe('the status a worker shows', () => {
  // status × need × turnRunning: a need wins, Working only while a turn runs, anything else its own word.
  const cases: [CoreWorkerStatus, boolean, boolean, string][] = [
    ['working', false, true, 'working'],
    ['working', false, false, 'idle'],
    ['working', true, true, 'needs-you'],
    ['working', true, false, 'needs-you'],
    ['needs-you', false, true, 'working'],
    ['needs-you', false, false, 'idle'],
    ['needs-you', true, false, 'needs-you'],
    ['stalled', false, false, 'stalled'],
    ['stalled', false, true, 'stalled'],
    ['stalled', true, false, 'needs-you'],
    ['queued', false, false, 'queued'],
    ['queued', false, true, 'queued'],
    ['failed', false, false, 'failed'],
    ['handed-back', false, true, 'handed-back'],
    ['landed', false, false, 'landed'],
    ['dropped', false, false, 'dropped'],
  ]
  it.each(cases)('%s, need %s, turn running %s → %s', (status, need, turnRunning, shown) => {
    expect(shownWorkerStatus({ status, need: need ? NEED : null, turnRunning })).toBe(shown)
  })

  it('reads a working worker with no turn flag as Idle, never Working', () => {
    expect(shownWorkerStatus({ status: 'working' })).toBe('idle')
  })
})

describe('a stalled worker', () => {
  const stalled = workerEntry(wire())

  it('keeps its word through the wire, with its line after it', () => {
    expect(stalled.status).toBe('stalled')
    expect(WORKER_STATUS_WORDS.stalled).toBe('Stalled')
    expect(WORKER_STATUS_TONE.stalled).toBe('warning')
    expect(workerStatusWhy(stalled)).toBe('stopped twice without handing back')
    expect(WORKER_STALLED_WHY).toBe('stopped twice without handing back')
  })

  it('sits with the live workers, not the ones that need you or are done', () => {
    const working = workerEntry(wire({ id: 'w_a', status: 'working', turnRunning: true, createdAt: 2 }))
    const groups = workerGroups([stalled, working])
    expect(groups.working.map((w) => w.id).sort()).toEqual(['w_a', 'w_list'])
    expect(groups.needsYou).toEqual([])
    expect(groups.done).toEqual([])
  })

  it('does not light the amber "needs you" dot: it is its lead’s to act on', () => {
    expect(workersNeedYou([stalled])).toBe(false)
    expect(workersNeedYou([stalled, workerEntry(wire({ id: 'w_b', status: 'failed' }))])).toBe(true)
  })

  it('can still be asked to hand back: the prompt sets it working again', () => {
    expect(workerCanHandBack('stalled')).toBe(true)
  })

  it('reads "Stalled · stopped twice without handing back" in amber in its sidebar row, with an amber mark and no dot', () => {
    const html = renderToStaticMarkup(createElement(SidebarWorkerItem, { worker: stalled, active: false, onSelect: () => {}, actions: [] }))
    expect(html).toContain('Stalled · stopped twice without handing back')
    expect(html).toContain('text-warning-text')
    expect(html).toContain('text-warning')
    expect(html).not.toContain('text-danger')
  })

  it('says the same in its chat’s status line', () => {
    const html = renderToStaticMarkup(createElement(WorkerStatusLine, { status: stalled.status, why: workerStatusWhy(stalled)! }))
    expect(html).toContain('Stalled')
    expect(html).toContain('stopped twice without handing back')
  })
})

describe('the stalled notice in the lead’s chat', () => {
  const card = (stalled: boolean) =>
    renderToStaticMarkup(
      createElement(WorkerFailedCard, {
        workerId: 'w_list',
        workerLabel: 'Thread list',
        reason: stalled ? WORKER_STALLED_WHY : 'its container stopped unexpectedly',
        stalled,
        onOpenWorker: () => {},
      }),
    )

  it('reads "stalled" in amber, with the way to its chat', () => {
    const html = card(true)
    expect(html).toContain('Worker “Thread list” stalled: stopped twice without handing back')
    expect(html).toContain('Open its chat')
    expect(html).toContain('text-warning-text')
    expect(html).not.toContain('text-danger')
  })

  it('leaves a failure red, saying "failed"', () => {
    const html = card(false)
    expect(html).toContain('Worker “Thread list” failed: its container stopped unexpectedly')
    expect(html).toContain('text-danger-text')
    expect(html).not.toContain('text-warning')
  })
})
