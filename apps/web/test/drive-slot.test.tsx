// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveState } from '../src/lib/workspace'
import { agentDriveRefusal, humanDriving } from '../src/lib/feature-ui/drive'
import { slotBlocker, standingNotices, type StandingActs, type StandingInput } from '../src/lib/standing-notices'

/**
 * The drive slot for the two kinds of feature drive (triage-batch decisions 5,
 * 15, 16): the human's own Test drive, and the Review worker's. Tier 2: what
 * each card says and what its clicks do; the banner over the chat follows the
 * page's "is driving" flag, which only the human's drive sets.
 */

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ notes: { list: { invalidate: vi.fn() }, delivery: { invalidate: vi.fn() } } }),
    notes: {
      list: { useQuery: () => ({ data: [] }) },
      send: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { FeatureDriveSlot } = await import('../src/components/SidebarParts')
const { DriveChatNotice } = await import('../src/components/review/DriveChatNotice')
const { DRIVE_HOLDS_THE_AGENT } = await import('../src/components/review/SendToAgent')

const HUMAN: DriveState = { featureId: 'feat_1', branch: 'feature/checkout', purpose: 'human' }
const REVIEW: DriveState = {
  featureId: 'feat_1',
  branch: 'feature/checkout',
  purpose: 'review',
  workerId: 'sess_review',
  workerLabel: 'Review',
}

function slot(driving: DriveState) {
  const acts = { onOpenDrive: vi.fn(), onOpenWorker: vi.fn(), onStop: vi.fn() }
  render(<FeatureDriveSlot driving={driving} featureTitle="Checkout flow" {...acts} />)
  return acts
}

/** The chat's drive line, as the feature page renders it from its "is driving" flag. */
function banner(driving: DriveState) {
  render(<DriveChatNotice featureId="feat_1" driving={humanDriving(driving, 'feat_1')} stopping={false} onStop={async () => undefined} />)
}

afterEach(cleanup)

describe('the drive slot, the human’s own drive', () => {
  it('reads Test drive over the feature’s title, opens the drive and stops at once', () => {
    const acts = slot(HUMAN)
    expect(screen.getByText('Test drive')).toBeTruthy()
    expect(screen.getByText('Checkout flow')).toBeTruthy()
    fireEvent.click(screen.getByText('Test drive'))
    expect(acts.onOpenDrive).toHaveBeenCalledWith('feat_1')
    expect(acts.onOpenWorker).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop the test drive' }))
    expect(acts.onStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('raises the "agent can’t land its own edits" line over the chat', () => {
    banner(HUMAN)
    expect(screen.getByText(DRIVE_HOLDS_THE_AGENT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop drive' })).toBeTruthy()
  })
})

describe('the drive slot, the Review worker’s drive', () => {
  it('names the worker over the feature’s title and opens its chat on the feature’s page', () => {
    const acts = slot(REVIEW)
    expect(screen.getByText('Review worker is trying this feature')).toBeTruthy()
    expect(screen.getByText('Checkout flow')).toBeTruthy()
    fireEvent.click(screen.getByText('Review worker is trying this feature'))
    expect(acts.onOpenWorker).toHaveBeenCalledWith('feat_1', 'sess_review')
    expect(acts.onOpenDrive).not.toHaveBeenCalled()
  })

  it('asks before Stop, saying it ends the review’s drive and what the review does then', () => {
    const acts = slot(REVIEW)
    fireEvent.click(screen.getByRole('button', { name: 'Stop the review’s drive' }))
    expect(acts.onStop).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Stop the review’s drive?')
    expect(dialog.textContent).toContain('This ends the Review worker’s drive')
    expect(dialog.textContent).toContain('The review itself keeps running')
    fireEvent.click(screen.getByRole('button', { name: 'Keep it driving' }))
    expect(acts.onStop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Stop the review’s drive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop its drive' }))
    expect(acts.onStop).toHaveBeenCalledTimes(1)
  })

  it('raises no "agent can’t land its own edits" line over the chat', () => {
    banner(REVIEW)
    expect(screen.queryByText(DRIVE_HOLDS_THE_AGENT)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop drive' })).toBeNull()
  })

  it('names a verify review as the Review worker too', () => {
    slot({ ...REVIEW, workerLabel: 'Review: verify' })
    expect(screen.getByText('Review worker (verify) is trying this feature')).toBeTruthy()
  })

  it('refuses the human’s Test drive by naming the worker, with its chat one click away', () => {
    const info = { ...REVIEW, holderLabel: "the Review worker's drive of feature/checkout" }
    expect(agentDriveRefusal(info, 'feat_1')).toBe(
      'Review worker is trying this feature — your test drive waits until the review hands back',
    )
    expect(agentDriveRefusal({ ...info, purpose: 'human' }, 'feat_1')).toBeUndefined()

    const openWorker = vi.fn()
    const acts: StandingActs = { resolve: vi.fn(), resolving: false, dismissDenial: vi.fn(), stopDrive: vi.fn(), stopping: false, openWorker }
    const input: StandingInput = {
      shipped: false, branch: 'feature/checkout', conflict: null, conflictResolved: false, resolveEnded: false,
      liveSessionId: null, denial: null, unverified: null, phone: false,
      blockingDrive: slotBlocker(info, { id: 'feat_1', projectId: 'p' }, true),
    }
    const [row] = standingNotices(input, acts)
    expect(row?.title).toBe('Review worker is trying this feature')
    expect(row?.action?.label).toBe('Open its chat')
    row?.action?.onClick()
    expect(openWorker).toHaveBeenCalledWith('feat_1', 'sess_review')
  })
})
