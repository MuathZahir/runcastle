import { describe, expect, it } from 'vitest'
import { lapTimeline, type TimelineFinding, type TimelineTicket } from '../src/lib/feature-ui/timeline'
import type { TrailEntry, TrailPass } from '../src/lib/feature-ui/review'

/**
 * The lap timeline (decision 5): each lap's nodes in the order things
 * happened — work, the review pass, the fixes burned under it, the
 * verification — derived from ticket order alone.
 */
const trailPass = (over: Partial<TrailPass> = {}): TrailPass => ({
  ticketId: 'rev',
  seq: 2,
  passKind: 'review',
  mode: 'gates',
  verdict: 'verified',
  couldNotRun: false,
  videoUrl: null,
  ...over,
})

const entry = (over: Partial<TrailEntry> = {}): TrailEntry => ({
  lap: 1,
  completedAt: 1000,
  outcome: { kind: 'verified', mode: 'gates' },
  burned: 0,
  passes: [],
  defects: { found: 0, fixed: 0, carried: 0 },
  notes: 0,
  ...over,
})

const work = (seq: number, over: Partial<TimelineTicket> = {}): TimelineTicket => ({
  id: `imp_${seq}`,
  seq,
  title: `ticket ${seq}`,
  lap: 1,
  kind: 'implementation',
  status: 'done',
  ...over,
})

const review = (id: string, seq: number, over: Partial<TimelineTicket> = {}): TimelineTicket => ({
  id,
  seq,
  lap: 1,
  kind: 'review',
  status: 'done',
  ...over,
})

const defect = (over: Partial<TimelineFinding> = {}): TimelineFinding => ({
  lap: 1,
  kind: 'defect',
  status: 'open',
  reviewTicketId: 'rev',
  ...over,
})

/** Lap 1: #1 work, #2 review with 3 defects, #3–#5 fixes, #6 verification. */
const STORY = {
  entry: entry({
    passes: [
      trailPass({ ticketId: 'rev', seq: 2 }),
      trailPass({ ticketId: 'ver', seq: 6, passKind: 'verification', videoUrl: '/v.webm' }),
    ],
  }),
  tickets: [
    work(5),
    review('ver', 6),
    work(1),
    review('rev', 2),
    work(3),
    work(4),
  ],
  findings: [
    defect({ status: 'fixed' }),
    defect({ fixTicketId: 'imp_4' }),
    defect({ fixTicketId: 'imp_9' }),
    defect({ kind: 'observation' }),
  ],
}

describe('the lap timeline', () => {
  it('reads work, the review, the fixes under it, then the verification', () => {
    const nodes = lapTimeline(STORY.entry, STORY.tickets, STORY.findings)
    expect(nodes.map((n) => (n.kind === 'burn' ? `burn:${n.fixes ? 'fixes' : 'work'}:${n.tickets.map((t) => t.seq).join(',')}` : `pass:${n.passKind}:${n.seq}`))).toEqual([
      'burn:work:1',
      'pass:review:2',
      'burn:fixes:3,4,5',
      'pass:verification:6',
    ])
  })

  it('never lists a review ticket as a work row', () => {
    const nodes = lapTimeline(STORY.entry, STORY.tickets, STORY.findings)
    const rows = nodes.flatMap((n) => (n.kind === 'burn' ? n.tickets : []))
    expect(rows.some((t) => t.kind === 'review')).toBe(false)
  })

  it('gives the review the defects it found and the verification the ones fixed since', () => {
    const [, rev, , ver] = lapTimeline(STORY.entry, STORY.tickets, STORY.findings)
    expect(rev).toMatchObject({ kind: 'pass', found: 3, fixed: 0 })
    expect(ver).toMatchObject({ kind: 'pass', found: 0, fixed: 2, videoUrl: '/v.webm' })
  })

  it('makes one node per pass when a lap ran two reviews', () => {
    const nodes = lapTimeline(
      entry({ passes: [trailPass({ ticketId: 'a', seq: 2 }), trailPass({ ticketId: 'b', seq: 4 })] }),
      [work(1), review('a', 2), work(3), review('b', 4)],
    )
    expect(nodes.filter((n) => n.kind === 'pass').map((n) => (n.kind === 'pass' ? n.seq : 0))).toEqual([2, 4])
  })

  it('keeps a pass the ticket list does not know of, so its recording stays reachable', () => {
    const nodes = lapTimeline(entry({ passes: [trailPass({ ticketId: 'ghost', seq: 7, videoUrl: '/g.webm' })] }), [work(1)])
    expect(nodes).toEqual([
      expect.objectContaining({ kind: 'burn', fixes: false }),
      expect.objectContaining({ kind: 'pass', ticketId: 'ghost', videoUrl: '/g.webm', completedAt: null }),
    ])
  })

  it('reads a review ticket the feed has no row for yet as a pass without a verdict', () => {
    const [, pass] = lapTimeline(entry(), [work(1), review('pending', 2, { status: 'pending', passKind: 'verification' })])
    expect(pass).toMatchObject({ kind: 'pass', passKind: 'verification', verdict: null, mode: null })
  })

  it('reads work with no pass yet as plain work, not fixes', () => {
    expect(lapTimeline(entry(), [work(1), work(2)])).toEqual([
      { kind: 'burn', fixes: false, tickets: [work(1), work(2)] },
    ])
  })

  it('ignores other laps', () => {
    expect(lapTimeline(entry(), [work(1, { lap: 2 })])).toEqual([])
  })

  it('carries the pass’s own opening line as its account', () => {
    const [pass] = lapTimeline(entry({ passes: [trailPass()] }), [
      review('rev', 2, { digest: 'Lap 1: the filter landed · 0 defects · Gates mode\n\nLonger prose.' }),
    ])
    expect(pass).toMatchObject({ account: 'The filter landed', reason: null })
  })

  it('states an unverified lap’s templated line and reason on the pass it was read off', () => {
    const [pass] = lapTimeline(
      entry({
        passes: [trailPass({ verdict: 'unverified', mode: 'drive' })],
        outcome: { kind: 'unverified', line: 'Lap 1 · drive mode · DRIVE FAILED · nothing verified', reason: 'no browser' },
      }),
      [review('rev', 2, { digest: 'Lap 1 · drive mode · DRIVE FAILED · nothing verified\n\nAgent prose.' })],
    )
    expect(pass).toMatchObject({ account: 'Lap 1 · drive mode · DRIVE FAILED · nothing verified', reason: 'no browser' })
  })
})
