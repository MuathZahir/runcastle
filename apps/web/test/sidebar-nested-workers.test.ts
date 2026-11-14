import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarEpics } from '../src/components/SidebarEpics'
import { SidebarFeatureRow, type FeatureWorkers } from '../src/components/SidebarParts'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { epicsFrom } from '../src/lib/feature-ui/epics'
import { takesNewWorkers, type WorkerEntry } from '../src/lib/workers'
import { listItem, need } from './fixtures'

/**
 * Workers nest under their feature (docs/features/workers-nest-under-their-
 * feature, the design page "workers-nested"): a feature row draws its live
 * workers under it, needs you and failed first; only the open feature folds its
 * finished ones into "N done"; a folded row keeps its need's amber dot; "+"
 * starts a worker on a feature in progress only; a locked feature's worker rows
 * wear the lock and never the dot. Tier 1: the markup is the whole behaviour.
 */

const worker = (id: string, status: WorkerEntry['status'], createdAt: number, over: Partial<WorkerEntry> = {}): WorkerEntry => ({
  id,
  label: id,
  purpose: '',
  status,
  startedBy: 'lead',
  createdAt,
  updatedAt: createdAt,
  ...over,
})

const asks = (id: string, createdAt: number) => worker(id, 'needs-you', createdAt, { need: need(`${id} asks`) })

const entries = [
  worker('Queued one', 'queued', 50),
  worker('Working one', 'working', 40),
  asks('Asking one', 10),
  worker('Idle one', 'idle', 30),
  worker('Failed one', 'failed', 20),
  worker('Landed one', 'landed', 60),
  worker('Handed back one', 'handed-back', 70),
  worker('Old chat', 'handed-back', 5, { old: 'side' }),
]

const workers = (over: Partial<FeatureWorkers> = {}): FeatureWorkers => ({
  entries,
  current: null,
  onOpen: () => {},
  actionsFor: () => [],
  ...over,
})

const f = (over: Partial<FeatureListItem> = {}) => ({ ...listItem({ id: 'feat_1' }), title: 'Checkout coupons', ...over }) as FeatureListItem

function row(props: Partial<Parameters<typeof SidebarFeatureRow>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(SidebarFeatureRow, { f: f(), active: false, onSelect: () => {}, actions: [], workers: workers(), ...props }),
  )
}

/** The worker titles in the order the markup draws them. */
const order = (html: string) =>
  [...html.matchAll(/title="([^"]+?)(?: — [^"]*)?"/g)].map((m) => m[1]).filter((t) => entries.some((e) => e.label === t))

describe('workers nested under their feature', () => {
  it('draws the live workers under the row: needs you and failed first, then working, idle and queued', () => {
    expect(order(row())).toEqual(['Failed one', 'Asking one', 'Working one', 'Idle one', 'Queued one'])
  })

  it('folds the finished workers and old chats into "N done" under the open feature only', () => {
    const open = row({ active: true, workers: workers({ withDone: true }) })
    expect(open).toContain('3 done')
    expect(open).toContain('data-open-feature')
    // Folded by default: the finished rows are not drawn until it opens.
    expect(order(open)).not.toContain('Landed one')

    const elsewhere = row()
    expect(elsewhere).not.toContain('done</span>')
    expect(elsewhere).not.toContain('data-open-feature')
  })

  it('opens "N done" when the worker in front is a finished one', () => {
    const open = row({ active: true, workers: workers({ withDone: true, current: 'Landed one' }) })
    expect(order(open)).toContain('Landed one')
  })

  it('folds away every worker and keeps the amber dot when one of them needs you', () => {
    const folded = row({ workersFolded: true })
    expect(order(folded)).toEqual([])
    expect(folded).toContain('aria-label="Show workers"')
    expect(folded).toContain('bg-warning')

    // The feature's own chat asks nothing and no worker asks: no dot, folded or not.
    const calm = row({ workersFolded: true, workers: workers({ entries: [worker('Working one', 'working', 1)] }) })
    expect(calm).not.toContain('bg-warning')
  })

  describe("a worker's need shows once (decision 12)", () => {
    const workerAsks = f({ status: 'active', need: need('Asking one asks', { threadId: 'Asking one' }) })
    const leadAsks = f({ status: 'active', need: need('Which retry policy?') })
    /** The feature row alone: the markup before its first nested worker. */
    const featureRow = (html: string) => html.slice(0, html.indexOf('Failed one'))
    const dots = (html: string) => html.match(/bg-warning/g)?.length ?? 0

    it("unfolded, the worker's need is on its own row only", () => {
      const html = row({ f: workerAsks })
      expect(featureRow(html)).not.toContain('Needs you')
      expect(featureRow(html)).toContain('Idle')
      // One amber dot: the worker's.
      expect(dots(html)).toBe(1)
      expect(html).toContain('Asking one asks')
    })

    it("folded, the worker's need rolls up to the feature row", () => {
      const html = row({ f: workerAsks, workersFolded: true })
      expect(html).toContain('Needs you · Asking one asks')
      expect(dots(html)).toBe(1)
      expect(order(html)).toEqual([])
    })

    it("the lead's own need still shows on the feature row, unfolded", () => {
      const html = row({ f: leadAsks })
      expect(featureRow(html)).toContain('Needs you · Which retry policy?')
      // The lead's dot, and the worker's own on its row.
      expect(dots(html)).toBe(2)
    })
  })

  it('carries a fold chevron only on a row with workers under it', () => {
    expect(row()).toContain('aria-label="Hide workers"')
    expect(row({ workers: workers({ entries: [worker('Landed one', 'landed', 1)] }) })).not.toContain('workers"')
  })

  it('offers "+" New worker on a feature in progress, and on no draft, shipped or archived one', () => {
    expect(takesNewWorkers(f({ status: 'active' }))).toBe(true)
    for (const status of ['draft', 'shipped', 'archived'] as const) expect(takesNewWorkers(f({ status }))).toBe(false)
    expect(row({ onNewThread: () => {} })).toContain('aria-label="New worker"')
    expect(row()).not.toContain('New worker')
  })

  it('locks the worker rows of a feature on autopilot, with no amber dot', () => {
    const epic: ThreadEntry = { id: 'chat_1', title: 'Checkout flow', role: 'project', state: 'working', createdAt: 0, updatedAt: 0, runtime: 'claude-code', need: null, autopilot: true }
    const locked = f({ chatId: epic.id, autopilot: { epicId: epic.id, epicName: epic.title } })
    const html = renderToStaticMarkup(
      createElement(SidebarEpics, {
        epics: epicsFrom([epic], [locked], () => true).epics,
        total: 1,
        currentChat: null,
        currentFeature: null,
        onOpenEpic: () => {},
        onSelectFeature: () => {},
        onAllEpics: () => {},
        workersFor: () => workers(),
      }),
    )
    // The feature and each of its five live workers wear the lock.
    expect(html.match(/aria-label="On autopilot"/g)).toHaveLength(6)
    expect(html).not.toContain('bg-warning')
    expect(html).not.toContain('Needs you')
    expect(order(html)).toContain('Asking one')
  })
})
