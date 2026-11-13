import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ThreadEntry, WorkerRow } from '@runcastle/core'
import { FeatureSidebarPage } from '../src/components/workers/FeatureSidebarPage'
import { workerColumnProps } from '../src/components/workers/WorkerChat'
import { featureWorkerEntries, shownWorkerStatus, workerGroups, workerStatusWhy } from '../src/lib/workers'
import { listItem } from './fixtures'

/**
 * The drive's Fix-drive and Scenarios workers on the feature's sidebar page
 * (drive-chats-become-workers decisions 10, 11): they sit in the worker groups
 * by status like any worker, with no list of their own under the lead, and an
 * old drive chat is a read-only transcript in Done. Tier 1: the markup is the
 * behaviour.
 */

type Wire = Parameters<typeof featureWorkerEntries>[0][number]

const wire = (id: string, label: string, over: Partial<WorkerRow>): Wire => ({
  id,
  label,
  purpose: '',
  kind: 'with-you',
  goal: null,
  doneWhen: null,
  model: 'claude-opus-5-5',
  startedBy: 'lead',
  status: 'working',
  failure: null,
  createdAt: 1,
  updatedAt: 0,
  ...over,
})

const thread = (id: string, title: string, role: ThreadEntry['role']): ThreadEntry => ({
  id,
  title,
  role,
  state: 'idle',
  createdAt: 1,
  updatedAt: 0,
  runtime: 'claude-code',
  need: null,
})

const rows: Wire[] = [
  { ...wire('w_head', 'Header', { status: 'working', createdAt: 3 }), turnRunning: true },
  {
    ...wire('w_scen', 'Scenarios', { kind: 'scenario', startedBy: 'human', status: 'needs-you', createdAt: 2 }),
    need: { why: 'Which seed?', since: 2, threadId: 'w_scen', by: 'agent' as const },
  },
  wire('w_fix', 'Fix drive', { kind: 'fix-drive', startedBy: 'human', status: 'handed-back', createdAt: 1 }),
]
const lead = thread('th_main', 'Coupon expiry', 'main')
const threads = [lead, thread('w_head', 'Header', 'worker'), thread('th_fix', 'Fix the seed', 'old-drive-chat'), thread('th_side', 'A side thread', 'side')]

describe('drive workers in the feature’s worker groups', () => {
  it('groups them by status with the other workers, and an old drive chat in Done', () => {
    const groups = workerGroups(featureWorkerEntries(rows, threads))
    expect(groups.needsYou.map((w) => w.label)).toEqual(['Scenarios'])
    expect(groups.working.map((w) => w.label)).toEqual(['Header'])
    expect(groups.done.map((w) => [w.label, w.old ?? null])).toEqual([
      ['Fix drive', null],
      ['Fix the seed', 'drive'],
      ['A side thread', 'side'],
    ])
  })

  it('draws them in the lanes, the old drive chat as "Old drive chat", and no chat list under the lead', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureSidebarPage, {
        feature: listItem(),
        leadStatus: 'Working',
        onBack: () => {},
        onNewWorker: () => {},
        lead,
        workers: featureWorkerEntries(rows, threads),
        current: null,
        onOpen: () => {},
        leadActions: [],
        actionsFor: () => [],
        defaultDoneOpen: true,
      }) as ReactElement,
    )
    const needsYou = html.slice(html.indexOf('aria-label="Needs you"'))
    expect(needsYou.indexOf('Scenarios')).toBeLessThan(needsYou.indexOf('Header'))
    expect(html).toContain('Old drive chat')
    expect(html).not.toContain('aria-label="Chats"')
  })
})

/** needs-you-is-the-agent-s-call decision 6: its own need, else Working while a turn runs, else Idle. */
describe('a worker’s shown status', () => {
  const need = { why: 'Which header?', since: 1, threadId: 'w', by: 'agent' as const }

  it('needs you only on its own need, whatever its status or turn', () => {
    expect(shownWorkerStatus({ status: 'working', need, turnRunning: true })).toBe('needs-you')
    expect(shownWorkerStatus({ status: 'needs-you', need: null, turnRunning: false })).toBe('idle')
  })

  it('reads Working while a turn runs, else Idle', () => {
    expect(shownWorkerStatus({ status: 'working', need: null, turnRunning: true })).toBe('working')
    expect(shownWorkerStatus({ status: 'working', need: null, turnRunning: false })).toBe('idle')
  })

  it('keeps a settled, queued or failed worker’s own word', () => {
    for (const status of ['queued', 'handed-back', 'landed', 'dropped', 'failed'] as const)
      expect(shownWorkerStatus({ status, need: null, turnRunning: false })).toBe(status)
  })

  it('draws an idle worker in the in-play group, reading Idle', () => {
    const idle = featureWorkerEntries([wire('w_i', 'Idle one', { status: 'working' })], [])
    expect(workerGroups(idle).working.map((w) => w.status)).toEqual(['idle'])
    const html = renderToStaticMarkup(
      createElement(FeatureSidebarPage, {
        feature: listItem(),
        leadStatus: 'Idle',
        onBack: () => {},
        onNewWorker: () => {},
        lead,
        workers: idle,
        current: null,
        onOpen: () => {},
        leadActions: [],
        actionsFor: () => [],
      }) as ReactElement,
    )
    expect(html).toContain('>Idle<')
    expect(html).not.toContain('text-shimmer">Idle')
  })

  it('says a worker that needs you in its agent’s line', () => {
    const [entry] = featureWorkerEntries([{ ...wire('w_n', 'Asks', { status: 'working' }), need }], [])
    expect(entry).toMatchObject({ status: 'needs-you', need })
    expect(workerStatusWhy(entry!)).toBe('Which header?')
  })
})

describe('an old drive chat in front', () => {
  it('is a read-only transcript: the old-drive-chat note stands where the composer was', () => {
    const props = workerColumnProps({ kind: 'old-chat', old: 'drive', thread: threads[2]! }, 'feature/coupon')
    expect(props.placeholder).toBeUndefined()
    expect(renderToStaticMarkup(props.closed as ReactElement)).toContain('Old drive chat — read-only')
  })
})
