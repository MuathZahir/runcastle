import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'
import { ReviewTrail } from '../src/components/review/ReviewTrail'

/**
 * The lap trail as a timeline (decision 5) — the feature page's history.
 *
 * Tier 1: the band's whole behaviour is the entries it emits from the per-pass
 * artifacts feed — which laps, in which order, with which outcome — and it is
 * rendered over the REAL derivation rather than over canned entries, because
 * the questions worth asking (does an unverified lap state runcastle's own
 * line, does a pre-feature pass get a chip) are answered by the two together.
 */
const pass = (over: Partial<ReviewArtifacts> = {}): ReviewArtifacts => ({
  ticketId: 'tkt_1',
  seq: 4,
  lap: 1,
  passKind: 'review',
  reviewMode: 'drive',
  reviewVerdict: 'verified',
  reviewVerdictReason: null,
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_1/walkthrough.webm',
  ...over,
})

const ticket = (over: Partial<FeatureFull['tickets'][number]> = {}) =>
  ({
    id: 'tkt_1',
    seq: 4,
    lap: 1,
    title: 'review the lap',
    kind: 'review',
    status: 'done',
    ...over,
  }) as unknown as FeatureFull['tickets'][number]

const defect = (over: Partial<ReviewFinding> = {}) =>
  ({ lap: 1, kind: 'defect', status: 'open', ...over }) as ReviewFinding

const note = (over: Partial<TestNote> = {}) => ({ lap: 1, status: 'open', ...over }) as TestNote

const render = (props: Partial<Parameters<typeof ReviewTrail>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(ReviewTrail, {
      passes: [pass()],
      tickets: [ticket()],
      findings: [],
      notes: [],
      currentLap: 1,
      staged: null,
      onStage: () => undefined,
      ...props,
    }),
  )

/** Lap 2 found six defects; lap 3's pass verified nothing — the walked story. */
const TWO_LAPS = {
  passes: [
    pass({ ticketId: 'tkt_a', seq: 4, lap: 2, completedAt: 1000 }),
    pass({
      ticketId: 'tkt_b',
      seq: 9,
      lap: 3,
      completedAt: 5000,
      reviewVerdict: 'unverified',
      reviewVerdictReason: 'no browser could be attached',
      hasVideo: false,
      videoUrl: null,
    }),
  ],
  tickets: [
    ticket({ id: 'tkt_a', seq: 4, lap: 2 }),
    ticket({
      id: 'tkt_b',
      seq: 9,
      lap: 3,
      digest:
        'Lap 3 · drive mode · DRIVE FAILED · nothing verified — no browser could be attached\n\n' +
        'All acceptance criteria remain honestly unverified.',
    }),
  ],
  currentLap: 3,
}

/** What the current lap says, from its heading on — earlier laps sit above it. */
const currentLap = (html: string): string => html.slice(html.indexOf('<h3'))

describe('the lap trail', () => {
  it('tells the laps oldest first: earlier ones folded above, the current one open last', () => {
    const html = render(TWO_LAPS)
    expect(html.indexOf('Lap 2')).toBeLessThan(html.indexOf('Lap 3'))
    expect(html).toMatch(/<h3[^>]*>Lap 3<\/h3>/)
    expect(html.match(/<details/g)).toHaveLength(1)
    expect(html).not.toContain('open=""')
  })

  it('draws no bordered card around a lap', () => {
    expect(render(TWO_LAPS)).not.toContain('rounded-lg border')
  })

  /** Decision 3: the Review status row owns the current lap's verdict. */
  it('heads the current lap with its time only, and an earlier lap with its verdict', () => {
    const html = render(TWO_LAPS)
    const heading = html.slice(html.indexOf('<h3'), html.indexOf('<ol', html.indexOf('<h3')))
    expect(heading).toContain('Reviewed ')
    expect(heading).not.toContain('Unverified')
    const earlier = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))
    expect(earlier).toContain('>Verified<')
    expect(earlier).toContain('drive mode')
    expect(earlier).toContain('Reviewed ')
  })

  it('opens an earlier lap in place onto its own timeline', () => {
    const html = render(TWO_LAPS)
    const folded = html.slice(html.indexOf('<details'), html.indexOf('</details>'))
    expect(folded).toContain('Review #4')
  })

  it('names the mode and verdict on the pass, gates included', () => {
    const html = render({ passes: [pass({ reviewMode: 'gates' })] })
    expect(html).toContain('Review #4')
    expect(html).toContain('>Verified<')
    expect(html).toContain('gates mode')
  })

  /** Review-as-a-lap-trail d5: the runcastle-filled template, never the agent's own prose. */
  it('states the templated line and the declared reason on an unverified pass', () => {
    const lap3 = currentLap(render(TWO_LAPS))
    expect(lap3).toContain('>Unverified<')
    expect(lap3).toContain('Lap 3 · drive mode · DRIVE FAILED · nothing verified')
    expect(lap3).toContain('no browser could be attached')
    expect(lap3).not.toContain('All acceptance criteria remain honestly unverified')
  })

  it('says the declared reason on its own when no templated line was stored', () => {
    const html = render({
      passes: [pass({ reviewVerdict: 'unverified', reviewVerdictReason: 'ffmpeg is missing' })],
      tickets: [ticket({ digest: undefined })],
    })
    expect(html).toContain('ffmpeg is missing')
  })

  /** Pre-feature passes carry no verdict: show none rather than invent one. */
  it('renders a pass that recorded no verdict without one', () => {
    const html = render({ passes: [pass({ reviewMode: null, reviewVerdict: null })] })
    expect(html).not.toContain('Verified')
    expect(html).not.toContain('Unverified')
    expect(html).toContain('Review #4')
  })

  it('reads a review ticket that failed as a pass that could not run', () => {
    const html = render({
      passes: [pass({ reviewVerdict: null, reviewMode: null })],
      tickets: [ticket({ status: 'failed' })],
    })
    expect(html).toContain('Could not run')
  })

  it('carries the pass’s own one-line account, not a restatement of its name', () => {
    const html = render({
      tickets: [ticket({ digest: 'Lap 1: the filter landed · 0 defects · Drive mode\n\nThe long account.' })],
    })
    expect(html).toContain('The filter landed')
    expect(html).not.toContain('The long account')
    expect(html).not.toContain('Lap 1: the filter landed.')
  })

  /** simplify-the-pages decision 7: history is reference, under a quiet label. */
  it('opens on a quiet "History" label, never a section heading', () => {
    const html = render({})
    expect(html).toMatch(/text-xs font-medium text-text-tertiary[^>]*><span[^>]*>History<\/span>/)
    expect(html).not.toMatch(/<h2[^>]*>History/)
  })

  /** Decision 5: work, the review, the fixes under it, the verification. */
  it('reads a lap top to bottom in the order it happened', () => {
    const html = render({
      passes: [
        pass({ ticketId: 'rev', seq: 2 }),
        pass({ ticketId: 'ver', seq: 6, passKind: 'verification', videoUrl: null }),
      ],
      tickets: [
        ticket({ id: 'imp_1', seq: 1, kind: 'implementation', title: 'filter by mood' }),
        ticket({ id: 'rev', seq: 2 }),
        ticket({ id: 'fix_3', seq: 3, kind: 'implementation', title: 'fix one' }),
        ticket({ id: 'fix_4', seq: 4, kind: 'implementation', title: 'fix two' }),
        ticket({ id: 'fix_5', seq: 5, kind: 'implementation', title: 'fix three' }),
        ticket({ id: 'ver', seq: 6 }),
      ],
      findings: [
        defect({ reviewTicketId: 'rev', status: 'fixed' }),
        defect({ reviewTicketId: 'rev', fixTicketId: 'fix_4' }),
        defect({ reviewTicketId: 'rev' }),
      ],
    })
    const order = ['Burned <span', '#1 · filter by mood', 'Review #2', '3 defects found', 'Burned <span', '#3 · fix one', '#5 · fix three', 'Verification #6', '2 fixed']
    let at = -1
    for (const text of order) {
      const next = html.indexOf(text, at + 1)
      expect(next, text).toBeGreaterThan(at)
      at = next
    }
    expect(html).toContain('>1 ticket<')
    expect(html).toContain('>3 fixes<')
    expect(html.match(/data-node="milestone"/g)).toHaveLength(2)
  })

  it('never lists a review or verification pass as a ticket row', () => {
    const html = render({
      tickets: [ticket(), ticket({ id: 'imp_1', seq: 1, kind: 'implementation' })],
      onViewRun: () => undefined,
    })
    expect(html.match(/data-list-row/g)).toHaveLength(1)
    expect(html).not.toContain('#4 · review the lap')
  })

  it('links each burned ticket to the run view, and counts what burned', () => {
    const html = render({
      tickets: [
        ticket(),
        ticket({ id: 'imp_1', seq: 1, kind: 'implementation', title: 'one' }),
        ticket({ id: 'imp_2', seq: 2, kind: 'implementation', title: 'two' }),
        ticket({ id: 'imp_3', seq: 3, kind: 'implementation', title: 'three', status: 'cancelled' }),
      ],
      onViewRun: () => undefined,
    })
    expect(html).toMatch(/Burned <span[^>]*>2 tickets</)
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*#1 · one/)
  })

  it('says a batch is burning while one of its tickets is, and queued before any started', () => {
    const burning = render({ passes: [], tickets: [ticket({ id: 'a', seq: 1, kind: 'implementation', status: 'burning' })] })
    expect(burning).toContain('Burning <span')
    const queued = render({ passes: [], tickets: [ticket({ id: 'a', seq: 1, kind: 'implementation', status: 'pending' })] })
    expect(queued).toContain('Queued <span')
  })

  /** A lap can hold several passes — one milestone each. */
  it('shows every pass of a lap, with the recording link that stages it', () => {
    const html = render({
      passes: [
        pass({ ticketId: 'tkt_a', seq: 4 }),
        pass({ ticketId: 'tkt_b', seq: 7, reviewMode: 'gates', completedAt: 4000, videoUrl: null }),
      ],
      tickets: [ticket({ id: 'tkt_a' }), ticket({ id: 'tkt_b', seq: 7 })],
    })
    expect(html).toContain('Review #4')
    expect(html).toContain('Review #7')
    expect(html.match(/data-node="milestone"/g)).toHaveLength(2)
    // Only the pass that left a recording offers one.
    expect(html.match(/>Recording</g)).toHaveLength(1)
  })

  /** A recording must never be unreachable. */
  it('still shows a pass the ticket list does not know of', () => {
    const html = render({ passes: [pass({ ticketId: 'ghost', seq: 9 })], tickets: [] })
    expect(html).toContain('Review #9')
    expect(html).toContain('>Recording<')
  })

  it('marks the pass whose recording is on the stage', () => {
    expect(render({ staged: 'tkt_1' })).toContain('aria-pressed="true"')
    expect(render({ staged: null })).toContain('aria-pressed="false"')
  })

  /** Defects and test notes are figures here; observations never appear at all. */
  it('counts an earlier lap’s defects found, fixed and carried, and its test notes', () => {
    const html = render({
      currentLap: 2,
      findings: [
        defect(),
        defect({ status: 'fixed' }),
        defect({ status: 'carried', carriedLap: 2 }),
        defect({ kind: 'observation', status: 'open' }),
      ],
      notes: [note(), note()],
    })
    const heading = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))
    expect(heading).toContain('3 defects found, 1 fixed, 1 carried')
    expect(heading).toContain('2 test notes')
    expect(html).not.toContain('observation')
  })

  /** The state an earlier lap is most often in: its fix tickets minted, not all burned. */
  it('counts on an earlier lap’s heading only the tickets that landed', () => {
    const html = render({
      currentLap: 2,
      tickets: [
        ticket(),
        ticket({ id: 'imp_1', seq: 1, kind: 'implementation' }),
        ticket({ id: 'fix_1', seq: 2, kind: 'implementation', status: 'pending' }),
        ticket({ id: 'imp_2', seq: 3, kind: 'implementation', status: 'burning' }),
        ticket({ id: 'imp_3', seq: 5, kind: 'implementation', status: 'failed' }),
      ],
    })
    expect(html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))).toContain('1 ticket burned')
  })

  /** A lap whose findings belong to another one never borrows them. */
  it('scopes every figure to the lap it is about', () => {
    const html = render({
      ...TWO_LAPS,
      findings: [defect({ lap: 2, reviewTicketId: 'tkt_a' }), defect({ lap: 2, status: 'fixed', reviewTicketId: 'tkt_a' })],
      notes: [note({ lap: 3 })],
    })
    expect(currentLap(html)).not.toContain('defects found')
    expect(html.slice(0, html.indexOf('<h3'))).toContain('2 defects found, 1 fixed')
  })

  /** A lap not reviewed yet reads differently from a lap that does not exist. */
  it('tells the current lap even before its own review has run', () => {
    const html = render({ passes: [pass({ lap: 1 })], currentLap: 2, tickets: [ticket()] })
    expect(html.indexOf('Lap 1')).toBeLessThan(html.indexOf('Lap 2'))
    expect(currentLap(html)).toContain('Not reviewed yet')
  })

  /** Nothing reviewed and nothing burned: no band at all rather than an empty box. */
  it('renders nothing when this feature has run no review pass and burned nothing', () => {
    expect(render({ passes: [], tickets: [] })).toBe('')
  })

  /** A shipped feature whose review never recorded a pass still tells its lap. */
  it('still tells a lap that burned tickets but recorded no pass', () => {
    const html = render({ passes: [], tickets: [ticket({ id: 'imp_1', seq: 1, kind: 'implementation', title: 'filter by mood' })] })
    expect(html).toContain('Lap 1')
    expect(html).toContain('#1 · filter by mood')
  })
})
