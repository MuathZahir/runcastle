// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two clicks the denied-drive banner carries. Tier 2 because a click is not
 * a string: what the markup says is tested next door, and what is asked here is
 * that Retry review reaches `ticket.retry` with the review ticket, and that the
 * refusal it hands back lands INSIDE the banner rather than in a toast.
 *
 * tRPC is the true boundary and the only thing stubbed. The stub keeps the
 * mutation's callbacks so the test can hand back the refusal the server would.
 */
interface RetryCallbacks {
  onSuccess?: () => void
  onError?: (e: { message: string }) => void
}

const retryMutate = vi.fn()
const invalidateFeature = vi.fn()
const invalidateEvents = vi.fn()
let retryCallbacks: RetryCallbacks = {}

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      feature: { get: { invalidate: (...a: unknown[]) => invalidateFeature(...a) } },
      events: { invalidate: (...a: unknown[]) => invalidateEvents(...a) },
    }),
    ticket: {
      retry: {
        useMutation: (callbacks: RetryCallbacks) => {
          retryCallbacks = callbacks
          return { mutate: (...a: unknown[]) => retryMutate(...a), isPending: false }
        },
      },
    },
  },
}))

const { ReviewDriveDeniedAlert } = await import('../src/components/review/ReviewDriveDeniedCard')

const denial = {
  eventId: 7,
  dirtyFiles: ['src/App.tsx'],
  message: 'review drive denied — 1 uncommitted file(s) in the working tree: src/App.tsx',
  at: 1_760_000_000_000,
}

const STILL_DIRTY =
  'the working tree is still dirty — the review drive would be denied again. Commit or discard ' +
  '1 file(s) first: src/App.tsx'

const onDismiss = vi.fn()

const mount = () =>
  render(
    <ReviewDriveDeniedAlert
      featureId="ftr_1"
      reviewTicketId="tkt_review_2"
      denial={denial}
      readonly={false}
      onDismiss={onDismiss}
    />,
  )

beforeEach(() => {
  retryMutate.mockClear()
  invalidateFeature.mockClear()
  invalidateEvents.mockClear()
  onDismiss.mockClear()
})
afterEach(cleanup)

describe('the denied-drive banner’s retry', () => {
  it('re-burns the review ticket the denial belongs to', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry review' }))
    expect(retryMutate).toHaveBeenCalledWith({ ticketId: 'tkt_review_2' })
  })

  it('shows the refusal in the banner, beside the files it is about', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry review' }))
    act(() => retryCallbacks.onError?.({ message: STILL_DIRTY }))
    expect(screen.getByText(STILL_DIRTY)).toBeTruthy()
    expect(screen.getByText('src/App.tsx')).toBeTruthy()
  })

  it('drops a stale refusal when the human tries again', () => {
    mount()
    const retry = screen.getByRole('button', { name: 'Retry review' })
    fireEvent.click(retry)
    act(() => retryCallbacks.onError?.({ message: STILL_DIRTY }))
    fireEvent.click(retry)
    expect(screen.queryByText(STILL_DIRTY)).toBeNull()
  })

  /** The banner clears itself off the run list, so the run this minted has to
   *  land before it can. */
  it('refetches the feature and the feed once the burn starts', () => {
    mount()
    act(() => retryCallbacks.onSuccess?.())
    expect(invalidateFeature).toHaveBeenCalledWith({ id: 'ftr_1' })
    expect(invalidateEvents).toHaveBeenCalled()
  })

  it('hands a dismissal back to the panel, which owns which denial was waved away', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
    expect(retryMutate).not.toHaveBeenCalled()
  })
})
