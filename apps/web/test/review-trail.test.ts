import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'
import { ReviewTrail } from '../src/components/review/ReviewTrail'

/**
 * The lap trail (decisions 4–5) — the review page's history band.
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

describe('the lap trail', () => {
  it('heads the newest lap as a section and folds earlier laps into closed disclosures', () => {
    const html = render(TWO_LAPS)
    expect(html.indexOf('Lap 3')).toBeLessThan(html.indexOf('Lap 2'))
    expect(html).toMatch(/<h2[^>]*>Lap 3<\/h2>/)
    expect(html.match(/<details/g)).toHaveLength(1)
    expect(html).not.toContain('open=""')
  })

  it('draws no bordered card around a lap', () => {
    expect(render(TWO_LAPS)).not.toContain('rounded-lg border')
  })

  it('stamps each entry with its outcome chip and when the lap was reviewed', () => {
    const html = render(TWO_LAPS)
    expect(html).toContain('>Verified<')
    expect(html).toContain('drive mode')
    expect(html).toContain('Unverified')
    expect(html).toContain('reviewed ')
  })

  it('names the mode a verified lap ran in, gates included', () => {
    const html = render({ passes: [pass({ reviewMode: 'gates' })] })
    expect(html).toContain('>Verified<')
    expect(html).toContain('gates mode')
  })

  /** Decision 5: the runcastle-filled template, never the agent's own prose. */
  it('states the templated line and the declared reason on an unverified lap', () => {
    const html = render(TWO_LAPS)
    expect(html).toContain('Lap 3 · drive mode · DRIVE FAILED · nothing verified')
    expect(html).toContain('no browser could be attached')
    expect(html).not.toContain('All acceptance criteria remain honestly unverified')
  })

  /** The template already carries the reason — saying it twice is noise. */
  it('says the declared reason on its own when no templated line was stored', () => {
    const html = render({
      passes: [pass({ reviewVerdict: 'unverified', reviewVerdictReason: 'ffmpeg is missing' })],
      tickets: [ticket({ digest: undefined })],
    })
    expect(html).toContain('ffmpeg is missing')
  })

  /** Pre-feature passes carry no verdict: show none rather than invent one. */
  it('renders a pass that recorded no verdict without a chip', () => {
    const html = render({
      passes: [pass({ reviewMode: null, reviewVerdict: null })],
    })
    expect(html).not.toContain('Verified')
    expect(html).not.toContain('Unverified')
    expect(html).toContain('Lap 1')
  })

  it('reads a review ticket that failed as a pass that could not run', () => {
    const html = render({
      passes: [pass({ reviewVerdict: null, reviewMode: null })],
      tickets: [ticket({ status: 'failed' })],
    })
    expect(html).toContain('Could not run')
  })

  it('counts what the lap burned, linking it to the run view', () => {
    const html = render({
      tickets: [
        ticket(),
        ticket({ id: 'imp_1', seq: 1, kind: 'implementation' }),
        ticket({ id: 'imp_2', seq: 2, kind: 'implementation' }),
        ticket({ id: 'imp_3', seq: 3, kind: 'implementation', status: 'cancelled' }),
      ],
      onViewRun: () => undefined,
    })
    expect(html).toContain('2 tickets burned')
    // Each burned ticket is a row that goes to the run view.
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*#1 · review the lap/)
  })

  /** The state the page is most often read in: a review reported a defect and
   *  its fix ticket is sitting pending for the human. Nothing burned it yet. */
  it('counts only the tickets that landed, never pending, burning or failed ones', () => {
    const html = render({
      tickets: [
        ticket(),
        ticket({ id: 'imp_1', seq: 1, kind: 'implementation' }),
        ticket({ id: 'fix_1', seq: 2, kind: 'implementation', status: 'pending' }),
        ticket({ id: 'imp_2', seq: 3, kind: 'implementation', status: 'burning' }),
        ticket({ id: 'imp_3', seq: 5, kind: 'implementation', status: 'failed' }),
      ],
    })
    expect(html).toContain('1 ticket burned')
  })

  /** A lap can hold several passes — the entry is the lap, the passes are rows. */
  it('lists every pass of a lap, with the recording link that stages it', () => {
    const html = render({
      passes: [
        pass({ ticketId: 'tkt_a', seq: 4 }),
        pass({
          ticketId: 'tkt_b',
          seq: 7,
          passKind: 'verification',
          reviewMode: 'gates',
          completedAt: 4000,
          hasVideo: false,
          videoUrl: null,
        }),
      ],
      tickets: [ticket({ id: 'tkt_a' }), ticket({ id: 'tkt_b', seq: 7 })],
    })
    expect(html).toContain('#4 · Review — drive mode, verified')
    expect(html).toContain('#7 · Verification — gates mode, verified')
    // Only the pass that left a recording offers one.
    expect(html.match(/>Recording</g)).toHaveLength(1)
  })

  it('marks the pass whose recording is on the stage', () => {
    expect(render({ staged: 'tkt_1' })).toContain('aria-pressed="true"')
  })

  /** Defects and test notes are figures here; observations never appear at all. */
  it('counts defects found, fixed and carried, and the lap’s test notes', () => {
    const html = render({
      findings: [
        defect(),
        defect({ status: 'fixed' }),
        defect({ status: 'carried', carriedLap: 2 }),
        defect({ kind: 'observation', status: 'open' }),
      ],
      notes: [note(), note()],
    })
    expect(html).toContain('3 defects found, 1 fixed, 1 carried')
    expect(html).toContain('2 test notes')
    expect(html).not.toContain('observation')
  })

  /** A lap whose findings belong to another one never borrows them. */
  it('scopes every count to the lap it is about', () => {
    const html = render({
      ...TWO_LAPS,
      findings: [defect({ lap: 2 }), defect({ lap: 2, status: 'fixed' })],
      notes: [note({ lap: 3 })],
    })
    const lap3 = html.slice(html.indexOf('Lap 3'), html.indexOf('Lap 2'))
    expect(lap3).not.toContain('defects found')
    expect(lap3).toContain('1 test note')
    expect(html.slice(html.indexOf('Lap 2'))).toContain('2 defects found, 1 fixed')
  })

  /** The current lap is an entry before it has been reviewed — a lap that has
   *  not been reviewed yet reads differently from a lap that does not exist. */
  it('opens on the current lap even before its own review has run', () => {
    const html = render({ passes: [pass({ lap: 1 })], currentLap: 2, tickets: [ticket()] })
    expect(html.indexOf('Lap 2')).toBeLessThan(html.indexOf('Lap 1'))
    expect(html).toContain('not reviewed yet')
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

  it('opens the lap with its account, when the review wrote one', () => {
    expect(render({ account: 'Lap 1: the filter landed.' })).toContain('Lap 1: the filter landed.')
  })
})
