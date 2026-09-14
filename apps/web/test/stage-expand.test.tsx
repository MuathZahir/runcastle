// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow, ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'
import { full } from './fixtures'

/**
 * The stage with the window to itself (decisions 3–4) — the seam is the review
 * page, because expanding is a fact about the whole page: the stage grows and
 * every band around it stands down, while the notes rail stays exactly where it
 * was.
 *
 * Tier 2: entering and leaving are a click, an F and an Escape, and what the
 * page does in between is state no static string can show.
 */
const state = vi.hoisted(() => ({
  drive: undefined as
    | { featureId: string; state: string; dryRun: boolean; devUrl: string; devReady: boolean }
    | undefined,
}))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] as EventRow[] }))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<typeof import('../src/lib/reviews')>()),
  useReviewArtifacts: () => ({ data: [RECORDING] }),
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
      ticket: { retry: { useMutation: mutation } },
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
        reopen: { useMutation: mutation },
        list: { useQuery: () => ({ data: [NOTE] }) },
      },
      findings: {
        dismiss: { useMutation: mutation },
        reopen: { useMutation: mutation },
        listByFeature: {
          useQuery: () => ({
            data: {
              findings: [],
              openDefects: [],
              carriedFindings: [CARRIED],
              summary: { found: 0, fixed: 0, open: 0, observations: 0 },
            },
          }),
        },
      },
      docs: { read: { useQuery: () => ({ data: undefined }) } },
      project: {
        prep: { useQuery: () => ({ data: { findings: [] } }) },
        list: {
          useQuery: () => ({
            data: [{ id: 'proj_1', driveInstructions: 'Drive the sample project.' }],
          }),
        },
      },
      feature: {
        commitCount: { useQuery: () => ({ data: { count: 3 } }) },
        driveInfo: { useQuery: () => ({ data: state.drive }) },
        testDrive: { useMutation: mutation },
        fixDrive: { useMutation: mutation },
        endSession: { useMutation: mutation },
      },
    },
  }
})

const { ReviewBody } = await import('../src/components/bodies/ReviewBody')

const RECORDING: ReviewArtifacts = {
  ticketId: 'tkt_review',
  seq: 4,
  lap: 1,
  passKind: 'review',
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_review/walkthrough.webm',
}

const NOTE = {
  id: 'note_1',
  featureId: 'feat_1',
  lap: 1,
  text: 'the spilled-at column shows raw epoch millis',
  status: 'open',
  author: 'human',
  createdAt: 10,
  updatedAt: 10,
} as TestNote

/** A carried finding, so the band the expand puts away is on the page at all. */
const CARRIED = {
  id: 'find_3',
  featureId: 'feat_1',
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'high',
  title: 'the husk rows keep their retired ids',
  detail: 'the endpoint builds its own map, so the operator still sees husks',
  location: 'DLQController.java:88',
  citation: 'spec.md §Retention',
  reproStep: 'GET /api/dlq/entries after a spill',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  status: 'carried',
  carriedLap: 2,
  resolutionNote: 'lap 2 rewrites the purge, which decides these rows',
  createdAt: 20,
} as ReviewFinding

const REVIEW_TICKET = {
  id: 'tkt_review',
  seq: 4,
  lap: 1,
  title: 'review the lap',
  kind: 'review',
  status: 'done',
  digest: 'Lap 1: the retention cap landed · 0 defects found',
} as unknown as FeatureFull['tickets'][number]

const SERVING = {
  featureId: 'feat_1',
  state: 'serving',
  dryRun: false,
  // `about:blank`, because the panel embeds whatever this is in a live iframe
  // and a dev server is not a boundary this test has any business crossing.
  devUrl: 'about:blank',
  devReady: true,
}

beforeEach(() => {
  state.drive = undefined
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

function page(): { root: HTMLElement; rerender: () => void } {
  const feature = full({ id: 'feat_1', phase: 'review' })
  const body = (): React.ReactElement => (
    <ReviewBody
      full={{ ...feature, feature: { ...feature.feature, lap: 1 }, tickets: [REVIEW_TICKET] }}
      driving={null}
      conflict={null}
      onViewPhase={() => undefined}
      onIterate={() => undefined}
    />
  )
  const view = render(body())
  return {
    root: view.container.firstElementChild as HTMLElement,
    // The queries answer differently on the next render — how a drive starting
    // or stopping reaches this page.
    rerender: () => view.rerender(body()),
  }
}

const expandControl = (): HTMLElement => screen.getByRole('button', { name: /^Expand|^Collapse/ })
const key = (k: string): void => void fireEvent.keyDown(document.body, { key: k })

/** The bands the expand puts away, one phrase each. */
const BANDS = ['checks passed', 'How to drive this app', 'Carried, still open', 'Full account']

describe('the review page expanded', () => {
  it('leaves the stage and the rail, and puts every other band away', () => {
    const { root } = page()
    for (const band of BANDS) expect.soft(screen.queryByText(new RegExp(band))).toBeTruthy()

    fireEvent.click(expandControl())

    // The overlay is a plain fixed layer over the workspace — not the native
    // Fullscreen API, which would take the rail with it.
    expect(root.className).toContain('fixed inset-0')
    expect(document.getElementById('evidence-stage')).toBeTruthy()
    expect(screen.getByText('What still needs attention')).toBeTruthy()
    expect(screen.getByLabelText(/what did you just see/i)).toBeTruthy()
    expect(screen.getByText(NOTE.text)).toBeTruthy()
    for (const band of BANDS) expect.soft(screen.queryByText(new RegExp(band))).toBeNull()
  })

  /** Expanding is for working: the tools the human annotates with come along. */
  it('keeps the transport bar and the way to annotate on the stage', () => {
    page()
    fireEvent.click(expandControl())

    expect(screen.getByLabelText('scrub the walkthrough')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Annotate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /playback speed/ })).toBeTruthy()
  })

  it('collapses back to the whole page, on the control and on Escape', () => {
    const { root } = page()

    fireEvent.click(expandControl())
    fireEvent.click(expandControl())
    expect(root.className).not.toContain('fixed inset-0')
    for (const band of BANDS) expect.soft(screen.queryByText(new RegExp(band))).toBeTruthy()

    fireEvent.click(expandControl())
    key('Escape')
    expect(root.className).not.toContain('fixed inset-0')
    for (const band of BANDS) expect.soft(screen.queryByText(new RegExp(band))).toBeTruthy()
  })

  it('toggles on F from wherever the eye is', () => {
    const { root } = page()

    key('f')
    expect(root.className).toContain('fixed inset-0')

    key('F')
    expect(root.className).not.toContain('fixed inset-0')
  })

  // A keystroke meant for a note is not a keystroke for the page.
  it('leaves F alone while a note is being typed', () => {
    const { root } = page()
    fireEvent.keyDown(screen.getByLabelText(/what did you just see/i), { key: 'f' })
    expect(root.className).not.toContain('fixed inset-0')
  })

  /**
   * Decision 4: one mechanism, whatever the stage is showing. The drive takes
   * the stage from the recording and gives it back, and the expand is not part
   * of that trade.
   */
  it('works the same on the drive, and survives the swap between the two', () => {
    const { root, rerender } = page()
    state.drive = SERVING
    rerender()
    expect(screen.getByTitle('the app on this branch')).toBeTruthy()

    key('f')
    expect(root.className).toContain('fixed inset-0')
    // The drive's own toolbar is an overlay inside the panel, so it comes along.
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()

    state.drive = undefined
    rerender()
    expect(screen.getByLabelText('review walkthrough')).toBeTruthy()
    expect(root.className).toContain('fixed inset-0')

    key('Escape')
    expect(root.className).not.toContain('fixed inset-0')
  })
})
