import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TestNote } from '@runcastle/core'
import type { ReviewArtifacts } from '../src/lib/reviews'

/**
 * The evidence stage (decisions 17, 20, 41) — the top of the review page.
 *
 * Tier 1: what is asked here is which of the two things is on the stage, what
 * the identity header says about the recording, and which affordances exist —
 * all of it in the emitted markup. The player's own transport is tier 2, in
 * `walkthrough-player.test.tsx`.
 *
 * Only the tRPC surface and the toast are stubbed, exactly as the player's own
 * test stubs them: they are the provider boundary, not this band's behaviour.
 */
vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ notes: { list: { invalidate: vi.fn() } }, feature: {}, events: {} }),
    notes: { add: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    feature: {
      testDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      fixDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { EvidenceStage } = await import('../src/components/review/EvidenceStage')

const recording = (over: Partial<ReviewArtifacts> = {}): ReviewArtifacts => ({
  ticketId: 'tkt_1',
  seq: 4,
  lap: 1,
  passKind: 'review',
  reviewMode: null,
  reviewVerdict: null,
  reviewVerdictReason: null,
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_1/walkthrough.webm',
  ...over,
})

const render = (props: Partial<Parameters<typeof EvidenceStage>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(EvidenceStage, {
      featureId: 'ftr_1',
      branch: 'feature/x',
      recordings: [recording()],
      notes: [] as TestNote[],
      readonly: false,
      driveState: 'idle',
      dryRun: false,
      failure: null,
      expand: { expanded: false, set: () => undefined },
      ...props,
    }),
  )

/** The same stage with the window to itself (decision 3). */
const expanded = (props: Partial<Parameters<typeof EvidenceStage>[0]> = {}): string =>
  render({ expand: { expanded: true, set: () => undefined }, ...props })

describe('EvidenceStage', () => {
  it('plays the latest completed pass by default, under its identity header', () => {
    const html = render({
      recordings: [
        recording({ ticketId: 'tkt_1', completedAt: 1000 }),
        recording({ ticketId: 'tkt_2', seq: 9, completedAt: 5000, videoUrl: '/later.webm' }),
      ],
    })
    expect(html).toContain('src="/later.webm"')
    expect(html).toContain('Walkthrough')
    expect(html).toContain('this build')
  })

  it('stamps a recording that predates the current build with the commit it reviewed', () => {
    const html = render({ recordings: [recording({ landedSince: 3 })] })
    expect(html).toContain('reviewed abc1234')
    expect(html).not.toContain('· this build')
  })

  /** Decision 41b: the header says what KIND of pass is on the stage. */
  it('names a verification pass and how many fixes it confirms', () => {
    const html = render({
      recordings: [
        recording({ ticketId: 'tkt_1', completedAt: 1000, landedSince: 4 }),
        recording({
          ticketId: 'tkt_2',
          seq: 9,
          completedAt: 5000,
          passKind: 'verification',
          landedSince: 0,
          videoUrl: '/verify.webm',
        }),
      ],
    })
    expect(html).toContain('Verification walkthrough')
    expect(html).toContain('confirms 4 fixes')
    expect(html).toContain('this build')
  })

  /**
   * The trail picks now (review-as-a-lap-trail decision 4): the stage is the
   * viewer and the page owns which recording is on it, so the popover that used
   * to list the earlier passes here is gone.
   */
  it('plays the recording the page picked, and lists no picker of its own', () => {
    const html = render({
      recordings: [
        recording({ ticketId: 'tkt_1', seq: 4, lap: 1, completedAt: 1000, videoUrl: '/first.webm' }),
        recording({ ticketId: 'tkt_2', seq: 9, lap: 2, completedAt: 5000, videoUrl: '/later.webm' }),
      ],
      picked: 'tkt_1',
    })
    expect(html).toContain('src="/first.webm"')
    expect(html).toContain('Lap 1 · Walkthrough')
    expect(html).not.toContain('Earlier recordings')
  })

  /**
   * Decision 4: the stage is never lap-scoped, so a lap that has recorded
   * nothing keeps the previous lap's recording up — identified by ITS lap — and
   * the stage never blanks on a lap flip.
   */
  it('keeps an earlier lap’s recording on the stage, named by the lap it is from', () => {
    const html = render({ recordings: [recording({ lap: 2, landedSince: 0 })] })
    expect(html).toContain('<video')
    expect(html).toContain('Lap 2 · Walkthrough')
  })

  /**
   * Decision 6: the placeholder is gone, and so is the sentence that was in it.
   * The stage is mounted only for a recording or a drive now, so with neither
   * there is nothing here to apologise about — the page renders no stage at all.
   */
  it('says nothing about a missing walkthrough and offers no drive of its own', () => {
    const html = render({ recordings: [] })
    expect(html).not.toContain('No walkthrough yet')
    expect(html).not.toContain('the review agent records one when it drives')
    expect(html).not.toContain('Open app ▶')
    expect(html).not.toContain('<video')
  })

  /** Decision 17: the drive takes the stage, and gives it back when it stops. */
  it('swaps the recording out for the drive while a drive is up', () => {
    const html = render({
      driveState: 'serving',
      drive: { branch: 'feature/x', devPaneId: 'pane_1', devUrl: 'http://localhost:5173', devReady: true },
    })
    expect(html).not.toContain('<video')
    expect(html).toMatch(/dev server/i)
  })

  /** Decision 20: a drive problem about the stage renders IN the stage. */
  it('renders a failed drive setup where the video would be', () => {
    const html = render({
      driveState: 'setup-failed',
      drive: { branch: 'feature/x' },
      failure: { command: 'bun setup', outcome: 'exited 3', output: 'boom', canFix: true },
    })
    expect(html).toContain('Drive setup failed')
    expect(html).toContain('bun setup')
    expect(html).toContain('Fix drive')
    expect(html).not.toContain('<video')
  })

  it('says a preparation dry run is holding the drive rather than offering one', () => {
    const html = render({ recordings: [], dryRun: true })
    expect(html).toContain('A preparation dry-run is holding the drive')
  })

  /** Decision 33a: history plays, it never acts. */
  it('drops Annotate on a readonly view', () => {
    const html = render({ readonly: true })
    expect(html).toContain('<video')
    expect(html).not.toContain('Annotate')
  })
})

/**
 * The stage's expand (decisions 3–4). What is asked here is the sizing and the
 * control, both of which are in the markup: the overlay itself belongs to the
 * page around the stage and is measured at that seam
 * (`stage-expand.test.tsx`).
 */
describe('EvidenceStage expanded', () => {
  const SERVING = {
    driveState: 'serving' as const,
    drive: { branch: 'feature/x', devPaneId: 'pane_1', devUrl: 'http://localhost:5173', devReady: true },
  }

  it('offers one expand control, naming the key that does the same thing', () => {
    const html = render()
    // An IconButton: its name is the verb, and F rides in its tooltip.
    expect(html).toContain('aria-label="Expand"')
    expect(html).toContain('aria-pressed="false"')
    // And the same single control while the drive is what is on the stage.
    expect(render(SERVING).match(/aria-label="Expand"/g)).toHaveLength(1)
  })

  it('says what the control now does, and that the stage is expanded', () => {
    const html = expanded()
    expect(html).toContain('aria-label="Collapse"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('aria-label="Expand"')
  })

  /**
   * The point of the expand: a frame that kept its aspect ratio or its viewport
   * clamp would be the size it always was inside a bigger box.
   */
  it('drops the 16:9 clamp for the overlay’s fill, on both sides of the swap', () => {
    for (const html of [expanded(), expanded(SERVING)]) {
      expect.soft(html).toContain('min-h-0 flex-1')
      expect.soft(html).not.toContain('aspect-video')
      expect.soft(html).not.toContain('max-h-[calc(100vh-320px)]')
    }
  })

  /** Collapsed, both sides wear the one 16:9 string the stage layer writes. */
  it('sizes both sides from one collapsed frame, 16:9 and clamped', () => {
    const frame = 'aspect-video max-h-[calc(100vh-320px)]'
    expect(render()).toContain(frame)
    expect(render(SERVING)).toContain(frame)
  })

  /** A page with nowhere to expand into (the shipped record) offers no expand. */
  it('offers no expand at all when the page hands it none', () => {
    const html = render({ expand: undefined })
    expect(html).not.toContain('aria-label="Expand"')
    expect(html).toContain('aspect-video')
  })
})
