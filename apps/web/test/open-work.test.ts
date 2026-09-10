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
      findings: { dismiss: { useMutation: mutation }, reopen: { useMutation: mutation } },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { OpenWork } = await import('../src/components/review/OpenWork')
const { WorkList, partitionWork } = await import('../src/components/review/WorkList')

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
  carriedLap: null,
  resolvedBy: null,
  resolutionNote: null,
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

/** What the page reads before it splits the rows in two. */
interface Work {
  lap?: number
  notes?: TestNote[]
  findings?: ReviewFinding[]
  openDefects?: ReviewFinding[]
  tickets?: FeatureFull['tickets']
}

const split = (work: Work) =>
  partitionWork({
    findings: work.findings ?? [],
    notes: work.notes ?? [],
    tickets: work.tickets ?? ([] as FeatureFull['tickets']),
    openDefects: work.openDefects ?? [],
  })

/** The attention band, as the review page composes it. */
function render(
  work: Work = {},
  over: Partial<Parameters<typeof OpenWork>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(OpenWork, {
      featureId: 'ftr_1',
      lap: work.lap ?? 1,
      rows: split(work).attention,
      readonly: false,
      onStage: null,
      ...over,
    }),
  )
}

/** The settled half — the same rows, where the Full account disclosure holds them. */
function renderSettled(work: Work = {}): string {
  return renderToStaticMarkup(
    createElement(WorkList, {
      featureId: 'ftr_1',
      rows: split(work).settled,
      readonly: false,
      onStage: null,
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
    const html = render(
      {
        findings: [finding({ id: 'd1', status: 'fixing', fixTicketId: 'tkt_9' })],
        openDefects: [],
        tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'burning' })],
      },
      { onViewLane: () => undefined },
    )
    expect(html).toContain('being fixed in the running burn · lane #9')
    // ...and the tally does not call it the human's problem.
    expect(html).toContain('0 open · 1 being fixed')
  })

  it('moves a landed fix out of the list and into the settled half', () => {
    const work = {
      findings: [finding({ id: 'd1', status: 'fixing', fixTicketId: 'tkt_9' })],
      openDefects: [],
      tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'done' })],
    }
    expect(render(work)).toContain('Nothing needs attention')
    expect(renderSettled(work)).toContain('the save drops the edited value')
  })

  it('files carried, quick-fixed and handled notes into the settled half, reopenable', () => {
    const work = {
      notes: [
        note({ id: 'n1', status: 'carried', carriedLap: 3, text: 'carried one' }),
        note({ id: 'n2', status: 'promoted', ticketId: 'tkt_9', text: 'ticketed one' }),
        note({ id: 'n3', status: 'done', text: 'handled one' }),
      ],
      tickets: [ticket({ id: 'tkt_9', seq: 9, status: 'pending', title: 'fix the chip' })],
    }
    const settled = renderSettled(work)
    expect(settled).toContain('carried into lap 3')
    expect(settled).toContain('>Reopen<')
    expect(settled).toContain('#9 fix the chip')
    // A handled note is struck through and keeps its toggle back to open.
    expect(settled).toContain('line-through')
    // None of them is still asking for attention.
    expect(render(work)).toContain('Nothing needs attention')
  })

  /**
   * A parked defect belongs to the carried band and to nothing else
   * (decisions #5) — filed here as well it would render twice, and the tally it
   * is deliberately outside of would count it.
   */
  it('leaves a carried defect to its own band, out of both halves of this list', () => {
    const work = {
      findings: [finding({ id: 'd1', status: 'carried', carriedLap: 3 })],
      openDefects: [],
    }
    expect(render(work)).toContain('Nothing needs attention')
    expect(renderSettled(work)).not.toContain('the save drops the edited value')
  })

  /**
   * The lap scoping's own trap: the server counts open defects for the CURRENT
   * lap only, so an earlier lap's leftover appears in no `openDefects` list at
   * all — and it used to fall through to "being fixed", which hid the human's
   * Dismiss behind a burn that was never running.
   */
  it('still calls an earlier lap’s leftover open, with the human’s Dismiss on it', () => {
    const html = render({
      lap: 2,
      findings: [finding({ id: 'd1', lap: 1 })],
      openDefects: [],
    })
    expect(html).toContain('the save drops the edited value')
    expect(html).toContain('>Dismiss<')
    expect(html).toContain('1 open')
    expect(html).not.toContain('being fixed')
  })

  it('groups the open list by lap once the feature is past lap 1', () => {
    const html = render({
      lap: 2,
      notes: [note({ id: 'n1', lap: 1, text: 'from lap one' }), note({ id: 'n2', lap: 2 })],
    })
    expect(html).toContain('Lap 1')
    expect(html).toContain('Lap 2')
  })

  /**
   * Decisions 2 and 8: an observation is not a row and not a count on arrival.
   * The band is the defects and the notes, and nothing else — the verdict line
   * and the observations list it carried both moved into the bottom disclosure.
   */
  it('renders no observation and no verdict line on arrival', () => {
    const html = render({
      findings: [
        finding({ id: 'd1' }),
        finding({ id: 'o1', kind: 'observation', title: 'mobile was not verified' }),
      ],
      openDefects: [finding({ id: 'd1' })],
    })
    expect(html).toContain('the save drops the edited value')
    expect(html).not.toContain('mobile was not verified')
    expect(html).not.toContain('defects found')
    expect(html).not.toContain('observation')
  })

  it('drops every control — the composer included — when the page is history', () => {
    const html = render({ notes: [note({ id: 'n1' })] }, { readonly: true })
    expect(html).toContain('the run chip goes grey while burning')
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('>Delete<')
    expect(html).not.toContain('what did you just see?')
  })
})
