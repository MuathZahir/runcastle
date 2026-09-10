// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewFinding } from '@runcastle/core'

/**
 * "Carried, still open" — the defects an earlier lap parked (decisions #5).
 *
 * Tier 2, because the band exists FOR its two verbs: whether a click on Reopen
 * calls `findings.reopen` and then refreshes the findings query — the same key
 * the event stream invalidates — is not something the markup can show. What the
 * band renders is asserted here too rather than in a second file: it is four
 * lines of it, and the rows' own anatomy is `note-row.test.ts`'s.
 */

const reopenFinding = vi.fn()
const dismissFinding = vi.fn()
const invalidateFindings = vi.fn()

vi.mock('../src/trpc', () => {
  // A mutation that runs its own `onSuccess`, so one click proves both halves of
  // the wiring: the verb it calls, and the query it refreshes afterwards.
  const verb = (spy: (input: unknown) => void) => (opts?: { onSuccess?: () => void }) => ({
    mutate: (input: unknown) => {
      spy(input)
      opts?.onSuccess?.()
    },
    mutateAsync: vi.fn(),
    isPending: false,
  })
  const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: (...a: unknown[]) => invalidateFindings(...a) } },
      }),
      notes: {
        add: { useMutation: stub },
        edit: { useMutation: stub },
        remove: { useMutation: stub },
        toggle: { useMutation: stub },
        reopen: { useMutation: stub },
      },
      findings: {
        dismiss: { useMutation: verb(dismissFinding) },
        reopen: { useMutation: verb(reopenFinding) },
      },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { CarriedFindings } = await import('../src/components/review/CarriedFindings')

const carried = (over: Partial<ReviewFinding> & { id: string }): ReviewFinding => ({
  featureId: 'ftr_1',
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'medium',
  title: 'the toast never dismisses',
  location: 'apps/web/src/lib/toast.tsx:20',
  citation: 'spec.md §Toasts',
  detail: 'The timer is cleared by the re-render before it fires.',
  reproStep: 'Save twice and watch the first toast.',
  status: 'carried',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  carriedLap: 2,
  resolvedBy: null,
  resolutionNote: null,
  createdAt: 10,
  ...over,
})

const band = (findings: ReviewFinding[], readonly = false) =>
  render(<CarriedFindings featureId="ftr_1" findings={findings} readonly={readonly} />)

beforeEach(() => {
  reopenFinding.mockClear()
  dismissFinding.mockClear()
  invalidateFindings.mockClear()
})
afterEach(cleanup)

describe('the carried findings band', () => {
  it('says which lap captured each parked defect and which lap it was parked into', () => {
    band([
      carried({ id: 'find_1', resolutionNote: 'lap 2 is rebuilding the toast host' }),
      carried({ id: 'find_2', lap: 2, carriedLap: 3, title: 'the drawer traps focus' }),
    ])
    expect(screen.getByText('Carried, still open')).toBeTruthy()
    expect(screen.getByText('captured lap 1, carried into lap 2')).toBeTruthy()
    expect(screen.getByText('captured lap 2, carried into lap 3')).toBeTruthy()
    expect(screen.getByText('lap 2 is rebuilding the toast host')).toBeTruthy()
    // Out of the open count, and saying so — the inflated "N still open" is what
    // carrying a defect exists to stop.
    expect(screen.getByText('2 carried · not counted as open')).toBeTruthy()
  })

  it('hands a parked defect back to the open pile, and refreshes the findings', () => {
    band([carried({ id: 'find_1' })])
    fireEvent.click(screen.getByText('Reopen'))
    expect(reopenFinding).toHaveBeenCalledWith({ findingId: 'find_1' })
    expect(invalidateFindings).toHaveBeenCalledWith({ featureId: 'ftr_1' })
  })

  it('waves a parked defect away for good, and refreshes the findings', () => {
    band([carried({ id: 'find_1' })])
    fireEvent.click(screen.getByText('Dismiss'))
    expect(dismissFinding).toHaveBeenCalledWith({ findingId: 'find_1' })
    expect(invalidateFindings).toHaveBeenCalledWith({ featureId: 'ftr_1' })
  })

  it('renders no band at all when no lap parked anything', () => {
    const { container } = band([])
    expect(container.innerHTML).toBe('')
  })

  it('keeps the record and drops both verbs when the page is history', () => {
    band([carried({ id: 'find_1' })], true)
    expect(screen.getByText('captured lap 1, carried into lap 2')).toBeTruthy()
    expect(screen.queryByText('Reopen')).toBeNull()
    expect(screen.queryByText('Dismiss')).toBeNull()
  })
})
