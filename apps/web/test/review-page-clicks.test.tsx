// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'
import { full } from './fixtures'

/**
 * The review page's two clicks that cross a band: picking a recording off the
 * lap trail, and asking for another review pass (review-as-a-lap-trail
 * decisions 4 and 6).
 *
 * The seam is the page, because both cross it — the trail below picks and the
 * stage above plays, and the mint is wired at the orchestrator and handed to
 * the state line. Tier 2 for the same reason the expand is: a click is not a
 * string, and what happens afterwards is not in the first render.
 */
const state = vi.hoisted(() => ({
  recordings: [] as ReviewArtifacts[],
  agenticReview: vi.fn(),
}))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] as EventRow[] }))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<typeof import('../src/lib/reviews')>()),
  useReviewArtifacts: () => ({ data: state.recordings }),
}))
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: vi.fn() } },
        feature: { get: { invalidate: vi.fn() }, driveInfo: { invalidate: vi.fn() } },
        events: { invalidate: vi.fn() },
      }),
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
        reopen: { useMutation: mutation },
        list: { useQuery: () => ({ data: [] as TestNote[] }) },
      },
      findings: {
        dismiss: { useMutation: mutation },
        reopen: { useMutation: mutation },
        listByFeature: {
          useQuery: () => ({
            data: {
              findings: [],
              openDefects: [],
              carriedFindings: [],
              summary: { found: 0, fixed: 0, open: 0, observations: 0 },
            },
          }),
        },
      },
      docs: { read: { useQuery: () => ({ data: undefined }) } },
      project: {
        prep: { useQuery: () => ({ data: { findings: [] } }) },
        list: { useQuery: () => ({ data: [{ id: 'proj_1' }] }) },
      },
      feature: {
        commitCount: { useQuery: () => ({ data: { count: 3 } }) },
        driveInfo: { useQuery: () => ({ data: undefined }) },
        testDrive: { useMutation: mutation },
        agenticReview: {
          useMutation: () => ({ mutate: state.agenticReview, isPending: false }),
        },
        fixDrive: { useMutation: mutation },
        endSession: { useMutation: mutation },
      },
    },
  }
})

const { ReviewBody } = await import('../src/components/bodies/ReviewBody')

const pass = (over: Partial<ReviewArtifacts>): ReviewArtifacts => ({
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
  videoUrl: '/lap-1.webm',
  ...over,
})

const ticket = (over: Partial<FeatureFull['tickets'][number]>) =>
  ({
    id: 'tkt_1',
    seq: 4,
    lap: 1,
    title: 'review the lap',
    kind: 'review',
    status: 'done',
    ...over,
  }) as unknown as FeatureFull['tickets'][number]

const LAP_1 = pass({})
const LAP_2 = pass({ ticketId: 'tkt_2', seq: 9, lap: 2, completedAt: 5000, videoUrl: '/lap-2.webm' })

beforeEach(() => {
  state.recordings = [LAP_1, LAP_2]
  state.agenticReview.mockClear()
  // The player HEADs its own recording for a size; the network is the one true
  // boundary here and no test plays real media.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ headers: { get: () => '21000000' } })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function page(lap = 2): void {
  const feature = full({ id: 'feat_1', phase: 'review' })
  render(
    <ReviewBody
      full={{
        ...feature,
        feature: { ...feature.feature, lap },
        tickets: [ticket({}), ticket({ id: 'tkt_2', seq: 9, lap: 2 })],
      }}
      driving={null}
      conflict={null}
      onViewPhase={() => undefined}
    />,
  )
}

const video = (): HTMLVideoElement => screen.getByLabelText('review walkthrough') as HTMLVideoElement

describe('picking a recording off the lap trail', () => {
  it('stages it in the player the page already has', () => {
    page()
    expect(video().getAttribute('src')).toBe('/lap-2.webm')

    const [earlier] = screen.getAllByRole('button', { name: 'Recording' }).slice(-1)
    fireEvent.click(earlier!)

    expect(video().getAttribute('src')).toBe('/lap-1.webm')
    expect(screen.getByText(/Lap 1 · Walkthrough/)).toBeTruthy()
  })

  /**
   * Decision 4: the stage is never lap-scoped. A lap that has recorded nothing
   * keeps the previous lap's recording up, named by the lap it is from, rather
   * than blanking the moment the lap flips.
   */
  it('keeps the latest recording on the stage when the lap has none of its own', () => {
    state.recordings = [LAP_1]
    page(3)
    expect(video().getAttribute('src')).toBe('/lap-1.webm')
    expect(screen.getByText(/Lap 1 · Walkthrough/)).toBeTruthy()
  })
})

/** Decision 6: the button beside Test drive mints a pass and burns it. */
describe('the Agentic review button', () => {
  it('asks the server to mint a fresh pass for this feature', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Agentic review' }))
    expect(state.agenticReview).toHaveBeenCalledWith({ featureId: 'feat_1' })
  })
})
