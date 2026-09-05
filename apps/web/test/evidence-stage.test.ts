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
      devConfigured: true,
      starting: false,
      onStartDrive: () => undefined,
      ...props,
    }),
  )

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

  /** Decision 41c: superseded passes are demoted, never hidden. */
  it('lists every older recording, each selectable onto the stage', () => {
    const html = render({
      recordings: [
        recording({ ticketId: 'tkt_1', seq: 4, lap: 1, completedAt: 1000 }),
        recording({ ticketId: 'tkt_0', seq: 2, lap: 1, completedAt: 500, passKind: 'verification' }),
        recording({ ticketId: 'tkt_2', seq: 9, lap: 2, completedAt: 5000 }),
      ],
    })
    expect(html).toContain('Earlier recordings (2)')
    expect(html).toContain('Lap 1 · verification pass · #2')
    expect(html).toContain('Lap 1 · review pass · #4')
  })

  it('renders no earlier-recordings disclosure when there is only one pass', () => {
    expect(render()).not.toContain('Earlier recordings')
  })

  /** Decision 17: the top of the page is never a dead card. */
  it('offers the drive with an honest note when no walkthrough exists yet', () => {
    const html = render({ recordings: [] })
    expect(html).toContain('No walkthrough yet')
    expect(html).toContain('the review agent records one when it drives')
    expect(html).toContain('Open app ▶')
    expect(html).not.toContain('<video')
  })

  it('disables Open app with its reason when the project has no dev command', () => {
    const html = render({ recordings: [], devConfigured: false })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Open app ▶<\/button>/)
    expect(html).toContain('no dev command · set one in Settings')
  })

  /** Decision 17: the drive takes the stage, and gives it back when it stops. */
  it('swaps the recording out for the drive while a drive is up', () => {
    const html = render({
      driveState: 'serving',
      drive: { branch: 'feature/x', devConfigured: true, devPaneId: 'pane_1' },
    })
    expect(html).not.toContain('<video')
    expect(html).toContain('dev server')
  })

  /** Decision 20: a drive problem about the stage renders IN the stage. */
  it('renders a failed drive setup where the video would be', () => {
    const html = render({
      driveState: 'setup-failed',
      drive: { branch: 'feature/x', devConfigured: true },
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
  it('drops Annotate and Open app on a readonly view', () => {
    const html = render({ readonly: true })
    expect(html).toContain('<video')
    expect(html).not.toContain('Annotate')
    expect(html).not.toContain('Open app ▶')
  })
})
