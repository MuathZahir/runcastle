import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DriveState, ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { lapChip, reviewChecks } from '../src/lib/feature-ui'
import type { ReviewArtifacts } from '../src/lib/reviews'

/**
 * Readonly is a rule of the layout, not a per-card patch (decision 33a).
 *
 * The walk found the conflict card gated on `conflict &&` and never on
 * `readonly`, offering to launch an agent from a shipped feature's history view,
 * plus two more of the same family — the inconsistency a per-card patch is how
 * you get. So the assertion here is made over the bands COMPOSED as the
 * orchestrator composes them, with `readonly` set once: no live control may
 * appear anywhere in the resulting markup.
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: vi.fn() } },
        feature: { driveInfo: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
        events: { invalidate: vi.fn() },
      }),
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
      },
      findings: { dismiss: { useMutation: mutation } },
      feature: {
        testDrive: { useMutation: mutation },
        fixDrive: { useMutation: mutation },
        endSession: { useMutation: mutation },
        launchSession: { useMutation: mutation },
      },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { ConflictAlert } = await import('../src/components/review/ConflictCard')
const { EvidenceStage } = await import('../src/components/review/EvidenceStage')
const { FullAccounts } = await import('../src/components/review/FullAccounts')
const { OpenWorkSlot } = await import('../src/components/review/OpenWorkSlot')
const { StatusStrip } = await import('../src/components/review/StatusStrip')

const RECORDING: ReviewArtifacts = {
  ticketId: 'tkt_1',
  seq: 4,
  lap: 2,
  passKind: 'review',
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_1/walkthrough.webm',
}

const NOTE: TestNote = {
  id: 'note_1',
  featureId: 'ftr_1',
  lap: 2,
  text: 'the run chip goes grey while burning',
  status: 'open',
  author: 'human',
  videoTimestamp: 42,
  reviewTicketId: 'tkt_1',
  createdAt: 1,
  updatedAt: 1,
}

const DEFECT = {
  id: 'find_1',
  featureId: 'ftr_1',
  lap: 2,
  reviewTicketId: 'tkt_1',
  kind: 'defect',
  severity: 'high',
  title: 'the merge dialog is blind to a standing conflict',
  location: 'apps/web/src/components/MergeFeatureDialog.tsx',
  citation: 'decision 29',
  detail: 'the dialog renders all-green over a branch that will re-conflict',
  reproStep: 'open the dialog over a conflict',
  status: 'open',
  openReason: 'over-cap',
  failureReason: null,
  fixTicketId: null,
  createdAt: 1,
} as ReviewFinding

/** The bands, in the orchestrator's own order, with one `readonly` for all of them. */
function bands(readonly: boolean): ReactNode[] {
  const tickets = [] as FeatureFull['tickets']
  return [
    createElement(EvidenceStage, {
      key: 'stage',
      featureId: 'ftr_1',
      branch: 'feature/x',
      recordings: [RECORDING],
      notes: [NOTE],
      readonly,
      driveState: 'idle',
      dryRun: false,
      failure: null,
      caps: { setup: true, dev: true, teardown: true },
      starting: false,
      onStartDrive: () => undefined,
    }),
    createElement(ConflictAlert, {
      key: 'conflict',
      featureId: 'ftr_1',
      branch: 'feature/x',
      conflict: { base: 'main', files: ['index.html'], at: 1 },
      readonly,
      liveSessionId: null,
    }),
    createElement(StatusStrip, {
      key: 'strip',
      artifact: { lap: 2 },
      currentLap: 2,
      landedSince: 0,
      tickets: [],
      checks: reviewChecks({ tickets: [], commitCount: 2 }),
      runState: 'succeeded',
      lap: lapChip([], { lap: 2, lapSessionRan: true }),
      laterLaps: 'A settings pane for the roster.',
      readonly,
    }),
    createElement(OpenWorkSlot, {
      key: 'work',
      featureId: 'ftr_1',
      lap: 2,
      tickets,
      notes: [NOTE],
      findings: [DEFECT],
      summary: { found: 1, fixed: 0, open: 1, observations: 0 },
      openDefects: [DEFECT],
      readonly,
    }),
    createElement(FullAccounts, {
      key: 'accounts',
      account: { source: 'review', prose: 'the lap landed the player rebuild' },
      tickets: [{ seq: 1, title: 'rebuild the player', lap: 2, digest: 'done' }],
    }),
  ]
}

const render = (readonly: boolean): string =>
  renderToStaticMarkup(createElement('div', null, bands(readonly)))

/** Every live control the resting review page offers, by the words on it. */
const LIVE_CONTROLS = ['Resolve with agent', 'Annotate', 'Open app ▶', 'Dismiss', 'Add', 'Edit', 'Delete']

/** The stage while a drive of this feature is up — its own set of controls. */
const drivingStage = (readonly: boolean, driveState: DriveState = 'setup-failed'): string =>
  renderToStaticMarkup(
    createElement(EvidenceStage, {
      featureId: 'ftr_1',
      branch: 'feature/x',
      recordings: [RECORDING],
      notes: [],
      readonly,
      driveState,
      drive: { branch: 'feature/x' },
      dryRun: false,
      failure: { command: 'bun setup', outcome: 'exited 3', output: 'boom', canFix: true },
      caps: { setup: true, dev: true, teardown: true },
      starting: false,
      onStartDrive: () => undefined,
    }),
  )

describe('the review bands under readonly', () => {
  it('offers every one of those controls while the feature is still being worked on', () => {
    const html = render(false)
    for (const control of LIVE_CONTROLS) expect(html, control).toContain(`>${control}<`)
  })

  it('offers none of them when the page is history', () => {
    const html = render(true)
    for (const control of LIVE_CONTROLS) expect(html, control).not.toContain(`>${control}<`)
  })

  /**
   * The walked bug itself: the card was gated on `conflict &&`, never on
   * `readonly`, so a shipped feature kept a live agent-launching button.
   */
  it('renders no conflict card at all on a readonly view', () => {
    expect(render(true)).not.toContain('Merge conflict')
    expect(render(false)).toContain('Merge conflict')
  })

  it('still plays the recording and still shows the evidence it has', () => {
    const html = render(true)
    expect(html).toContain('<video')
    expect(html).toContain(RECORDING.videoUrl!)
    expect(html).toContain('the run chip goes grey while burning')
    expect(html).toContain('the merge dialog is blind to a standing conflict')
  })

  it('states the deferred scope as history rather than as an instruction', () => {
    expect(render(true)).toContain('still deferred when this feature shipped')
  })

  /**
   * The drive's own controls live in the stage now (decision 20), so they answer
   * the same one flag: readonly keeps the account of the failure and drops both
   * offers to act on it.
   */
  it('keeps the drive`s account and drops its actions on a readonly view', () => {
    const live = drivingStage(false)
    expect(live).toContain('>Fix drive<')
    expect(live).toContain('>Stop test drive<')

    const history = drivingStage(true)
    expect(history).toContain('Drive setup failed')
    expect(history).toContain('bun setup')
    expect(history).not.toContain('>Fix drive<')
    expect(history).not.toContain('>Stop test drive<')
  })

  it('drops the review drive`s own stop on a readonly view', () => {
    expect(drivingStage(false, 'review-agent-driving')).toContain('>Stop the review drive<')
    expect(drivingStage(true, 'review-agent-driving')).not.toContain('>Stop the review drive<')
  })
})
