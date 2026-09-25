// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow, TestNote } from '@runcastle/core'
import { full } from './fixtures'

/**
 * A drive that is not this feature's, holding the one drive slot
 * (project-level-test-drive decision 9). The review page names it wherever it
 * blocks the Test drive control, in the server's own `holderLabel`, and — when
 * it is a project drive, the human's own session — offers to stop it right
 * there.
 *
 * Tier 2: the Stop click and the control coming back after it are not in the
 * first render.
 */
interface Drive {
  featureId?: string
  dryRun?: boolean
  projectDrive?: true
  projectId?: string
  holderLabel: string
  state: string
  branch: string
  devReady: boolean
  devConfigured: boolean
}

const state = vi.hoisted(() => ({
  drive: undefined as Drive | undefined,
  stopProjectDrive: vi.fn(),
}))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] as EventRow[] }))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<typeof import('../src/lib/reviews')>()),
  useReviewArtifacts: () => ({ data: [] }),
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
        testDrive: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              state.stopProjectDrive(input)
              state.drive = undefined
              opts.onSuccess?.()
            },
            isPending: false,
          }),
        },
      },
      feature: {
        commitCount: { useQuery: () => ({ data: { count: 3 } }) },
        driveInfo: { useQuery: () => ({ data: state.drive }) },
        testDrive: { useMutation: mutation },
        agenticReview: { useMutation: mutation },
        fixDrive: { useMutation: mutation },
        endSession: { useMutation: mutation },
      },
    },
  }
})

const { ReviewBody } = await import('../src/components/bodies/ReviewBody')

const drive = (over: Partial<Drive>): Drive => ({
  holderLabel: 'a test drive of feature/x',
  state: 'serving',
  branch: 'feature/x',
  devReady: true,
  devConfigured: true,
  ...over,
})

const PROJECT_DRIVE = drive({
  projectDrive: true,
  projectId: 'proj_1',
  branch: 'main',
  holderLabel: 'a project drive of main',
})

beforeEach(() => {
  state.drive = undefined
  state.stopProjectDrive.mockClear()
})

afterEach(cleanup)

function page(): { rerender: () => void } {
  const ui = () => (
    <ReviewBody
      full={full({ id: 'feat_1', phase: 'review', projectId: 'proj_1' } as never)}
      driving={null}
      conflict={null}
    />
  )
  const { rerender } = render(ui())
  return { rerender: () => rerender(ui()) }
}

/**
 * The Test drive control itself — and its "… is running — stop it first"
 * refusal — is the next-step bar's (feature-ui.test covers the resolver's
 * `disabled` reason for each holder). The body never repeats the control; what
 * it owns is the line naming the holder, and the one click that stops a project
 * drive.
 */
const noDuplicateControl = () => expect(screen.queryByRole('button', { name: 'Test drive' })).toBeNull()

describe('a project drive holding the slot', () => {
  it('names it on the page, beside the facts', () => {
    state.drive = PROJECT_DRIVE
    page()
    expect(screen.getByText('A project drive of main is running')).toBeTruthy()
    noDuplicateControl()
  })

  it('stops it from the inline line, and the line goes', () => {
    state.drive = PROJECT_DRIVE
    const { rerender } = page()
    expect(screen.getByText('A project drive of main is running')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop it' }))
    expect(state.stopProjectDrive).toHaveBeenCalledWith({ projectId: 'proj_1', action: 'stop' })

    rerender()
    expect(screen.queryByRole('button', { name: 'Stop it' })).toBeNull()
  })
})

describe('any other drive holding the slot', () => {
  it('offers no Stop it line for a preparation dry-run', () => {
    state.drive = drive({ dryRun: true, holderLabel: 'a preparation dry-run' })
    page()
    expect(screen.queryByRole('button', { name: 'Stop it' })).toBeNull()
    noDuplicateControl()
  })

  it("offers no Stop it line for another feature's drive", () => {
    state.drive = drive({ featureId: 'feat_2' })
    page()
    expect(screen.queryByRole('button', { name: 'Stop it' })).toBeNull()
    noDuplicateControl()
  })
})
