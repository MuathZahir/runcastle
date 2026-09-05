import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'

/**
 * "What still needs attention" (decision 18c): the review agent's defects and
 * the human's notes as ONE list, with everything already dealt with collapsed
 * beneath it.
 *
 * Tier 1 — the band's whole behaviour is which rows it puts where. It owns the
 * lifecycle mutations (dismiss, done, reopen), so the tRPC surface is stubbed
 * exactly as `review-body-readonly.test.ts` stubs it; nothing here fires one.
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: vi.fn() } },
      }),
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
        reopen: { useMutation: mutation },
      },
      findings: { dismiss: { useMutation: mutation } },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { OpenWork } = await import('../src/components/review/OpenWork')

const note = (over: Partial<TestNote> & { id: string }): TestNote => ({
  featureId: 'ftr_1',
  lap: 2,
  text: 'the run chip goes grey while burning',
  status: 'open',
  author: 'human',
  createdAt: 10,
  updatedAt: 10,
  ...over,
})

const finding = (over: Partial<ReviewFinding> & { id: string }): ReviewFinding => ({
  featureId: 'ftr_1',
  lap: 2,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'high',
  title: 'the save drops the edited value',
  location: 'packages/server/src/save.ts:42',
  citation: 'spec.md §Save requires persistence',
  detail: 'The save action writes the row and then re-reads the stale copy.',
  reproStep: 'Edit a ticket title, save, reload — the old title is back.',
  status: 'open',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  createdAt: 20,
  ...over,
})

const ticket = (over: { id: string; seq: number; status: string; title?: string }) =>
  ({
    id: over.id,
    seq: over.seq,
    status: over.status,
    title: over.title ?? 'fix the save',
    lap: 2,
  }) as unknown as FeatureFull['tickets'][number]

function render(
  over: Partial<Parameters<typeof OpenWork>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(OpenWork, {
      featureId: 'ftr_1',
      lap: 1,
      tickets: [] as FeatureFull['tickets'],
      notes: [],
      findings: [],
      openDefects: [],
      readonly: false,
      onStage: null,
      ...over,
    }),
  )
}

describe('OpenWork', () => {
  it('merges the review’s open defects and the human’s notes into one list', () => {
    const html = render({
      notes: [note({ id: 'n1' })],
      findings: [finding({ id: 'd1' })],
      openDefects: [finding({ id: 'd1' })],
    })
    expect(html).toContain('the save drops the edited value')
    expect(html).toContain('the run chip goes grey while burning')
    expect(html).toContain('2 open')
  })

  it('says so plainly when nothing is open', () => {
    expect(render()).toContain('Nothing needs attention')
  })

  /**
   * The walked gap: a defect being fixed in the running burn was in neither
   * list — the server drops it from `openDefects` the moment a fix ticket is
   * live, so the page went quiet about work that was in flight.
   */
  it('keeps a defect being fixed in the list, pointing at the lane fixing it', () => {
    const html = render({
      findings: [finding({ id: 'd1', status: 'fixing', fixTicketId: 'tkt_9' })],
      openDefects: [],
      tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'burning' })],
      onViewLane: () => undefined,
    })
    expect(html).toContain('being fixed in the running burn · lane #9')
  })

  it('moves a landed fix out of the list and into the collapsed group', () => {
    const html = render({
      findings: [finding({ id: 'd1', status: 'fixing', fixTicketId: 'tkt_9' })],
      openDefects: [],
      tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'done' })],
    })
    expect(html).toContain('Nothing needs attention')
    expect(html).toContain('Carried, quick-fixed and handled (1)')
  })

  it('collapses carried, quick-fixed and handled notes beneath, reopenable', () => {
    const html = render({
      notes: [
        note({ id: 'n1', status: 'carried', carriedLap: 3, text: 'carried one' }),
        note({ id: 'n2', status: 'promoted', ticketId: 'tkt_9', text: 'ticketed one' }),
        note({ id: 'n3', status: 'done', text: 'handled one' }),
      ],
      tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'pending', title: 'fix the chip' })],
    })
    expect(html).toContain('Carried, quick-fixed and handled (3)')
    expect(html).toContain('carried into lap 3')
    expect(html).toContain('>Reopen<')
    expect(html).toContain('#9 fix the chip')
    // A handled note is struck through and keeps its toggle back to open.
    expect(html).toContain('line-through')
    // None of them is still asking for attention.
    expect(html).toContain('Nothing needs attention')
  })

  it('groups the open list by lap once the feature is past lap 1', () => {
    const html = render({
      lap: 2,
      notes: [note({ id: 'n1', lap: 1, text: 'from lap one' }), note({ id: 'n2', lap: 2 })],
    })
    expect(html).toContain('Lap 1')
    expect(html).toContain('Lap 2')
  })

  it('leads with the review’s verdict and its observations', () => {
    const html = render({
      summary: { found: 2, fixed: 1, open: 1, observations: 1 },
      findings: [
        finding({ id: 'd1' }),
        finding({ id: 'o1', kind: 'observation', title: 'mobile was not verified' }),
      ],
      openDefects: [finding({ id: 'd1' })],
    })
    expect(html).toContain('2 defects found · 1 fixed automatically · 1 still open · 1 observation')
    expect(html).toContain('mobile was not verified')
  })

  it('renders no verdict line at all when the review reported nothing', () => {
    expect(render()).not.toContain('defects found')
  })

  it('drops every control — the composer included — when the page is history', () => {
    const html = render({ notes: [note({ id: 'n1' })], readonly: true })
    expect(html).toContain('the run chip goes grey while burning')
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('>Delete<')
    expect(html).not.toContain('what did you just see?')
  })
})
