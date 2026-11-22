// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queuePlaces, queueWords, WorkQueue, type QueueEntry, type WorkQueueProps } from '../src/components/WorkQueue'
import { toQueueEntry } from '../src/components/LiveWorkQueue'
import { SidebarFootChrome } from '../src/components/Sidebar'
import { waitingWords } from '../src/components/SidebarEpicFeatures'
import { PENDING_WORKER_MS, setPendingWorker, takePendingWorker } from '../src/lib/pending-worker'

/**
 * The machine's line of workers (one-number-for-how-many-build-at-once
 * decisions 3, 8, 9): the foot line's words, hidden when empty, the list's
 * order with places and a held entry, and a waiting row's own words.
 */
const NOW = 1_800_000_000_000
const entry = (id: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  id,
  label: `Worker ${id}`,
  kind: 'on-its-own',
  featureId: 'f1',
  featureTitle: 'Coupons',
  projectId: 'p1',
  projectName: 'Shop',
  since: NOW - 60_000,
  ...over,
})

const base: WorkQueueProps = { limit: 2, working: [], waiting: [], currentProjectId: 'p1', onOpen: () => undefined, now: NOW }
const line = (over: Partial<WorkQueueProps>) => renderToStaticMarkup(createElement(WorkQueue, { ...base, ...over }))

afterEach(cleanup)

describe('work queue line', () => {
  it('says how many work of the limit, and how many wait', () => {
    expect(queueWords(2, 2, 3)).toBe('2 of 2 working · 3 waiting')
    expect(queueWords(4, 1, 0)).toBe('1 of 4 working')
  })

  it('is hidden while nothing works or waits', () => {
    expect(line({})).toBe('')
  })

  it('shows on the foot, between the drives and the status line', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarFootChrome, {
        health: 'ok',
        origin: 'http://localhost:4513',
        notify: null,
        theme: 'dark',
        onToggleTheme: () => undefined,
        queue: createElement(WorkQueue, { ...base, working: [entry('a')], waiting: [entry('b')] }),
      }),
    )
    expect(html).toContain('data-work-queue')
    expect(html).toContain('1 of 2 working')
    expect(html).toContain(' · 1 waiting')
  })

  it('numbers the waiters in order, skipping a held one', () => {
    expect(queuePlaces([entry('a'), entry('b', { heldBy: 'usage limit' }), entry('c')])).toEqual([1, null, 2])
  })

  it('lists those working, then those waiting in order, naming other projects and a held reason', async () => {
    const onOpen = vi.fn()
    render(
      createElement(WorkQueue, {
        ...base,
        onOpen,
        working: [entry('a', { label: 'Build cart' })],
        waiting: [
          entry('b', { label: 'Build totals', projectId: 'p2', projectName: 'Blog' }),
          entry('c', { label: 'Review', kind: 'review', heldBy: 'usage limit until 14:00' }),
        ],
      }),
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /show the line/ })))
    const panel = await screen.findByLabelText('Workers working and waiting, on this machine')
    const text = panel.textContent ?? ''
    expect(text.indexOf('Build cart')).toBeLessThan(text.indexOf('Build totals'))
    expect(text.indexOf('Build totals')).toBeLessThan(text.indexOf('Review'))
    expect(text).toContain('Coupons · Blog')
    expect(text).toContain('held: usage limit until 14:00')
    expect(text).toContain('Limit: 2 at once')
    await act(async () => fireEvent.click(screen.getByText('Build totals')))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', projectId: 'p2' }))
  })
})

describe('the server entry', () => {
  it('maps onto the line’s entry, dropping an absent hold', () => {
    const e = toQueueEntry({
      workerId: 'w1',
      label: 'Build cart',
      kind: 'on-its-own',
      featureId: 'f1',
      featureSlug: 'coupons',
      featureTitle: 'Coupons',
      projectId: 'p1',
      projectName: 'Shop',
      since: NOW,
      heldBy: null,
    })
    expect(e).toMatchObject({ id: 'w1', featureSlug: 'coupons', featureTitle: 'Coupons' })
    expect('heldBy' in e).toBe(false)
  })
})

describe('a waiting row', () => {
  it('says its place in line, or held, and nothing when not waiting', () => {
    expect(waitingWords({ status: 'queued', place: 2 })).toBe('waiting · 2nd in line')
    expect(waitingWords({ status: 'queued', place: 1, heldBy: 'usage limit' })).toBe('held')
    expect(waitingWords({ status: 'queued' })).toBe('waiting')
    expect(waitingWords({ status: 'working', place: 1 })).toBeUndefined()
  })
})

describe('a worker asked for from another project', () => {
  it('is taken once, and only by its own project', () => {
    setPendingWorker({ projectId: 'p2', featureId: 'f9', workerId: 'w9' })
    expect(takePendingWorker('p1')).toBeNull()
    expect(takePendingWorker('p2')).toEqual({ projectId: 'p2', featureId: 'f9', workerId: 'w9' })
    expect(takePendingWorker('p2')).toBeNull()
  })

  it('lapses when its project never landed in time', () => {
    setPendingWorker({ projectId: 'p2', featureId: 'f9', workerId: 'w9' }, NOW)
    expect(takePendingWorker('p2', NOW + PENDING_WORKER_MS + 1)).toBeNull()
  })
})
