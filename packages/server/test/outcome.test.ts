import type { Feature, ReviewFinding, TestNote, Ticket, WorkerRow } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { composeOutcomeDoc, digestHasSubstance, type OutcomeInput } from '../src/services/outcome'

const feature: Feature = {
  id: 'feat_1', projectId: 'proj_1', slug: 'record', title: 'A durable record',
  oneLiner: 'Evidence and state first.',
  branch: 'feature/record', status: 'active', createdAt: 1,
  stoppedAt: null, waitingReason: null, lastHumanMessageAt: null, lastDispatchAt: null,
}
const ticket = (seq: number, overrides: Partial<Ticket> = {}): Ticket => ({
  id: `tkt_${seq}`, featureId: feature.id, seq, title: `Ticket ${seq}`, goal: 'ship', context: '',
  acceptanceCriteria: [], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review',
  status: 'done', commits: [], reviewedCommit: null, completedAt: 20 + seq,
  ...overrides,
})
const review = ticket(3, { kind: 'review', passKind: 'verification', reviewedCommit: 'abc123' })
const finding: ReviewFinding = {
  id: 'finding_1', featureId: feature.id, reviewTicketId: review.id, kind: 'defect',
  severity: 'high', title: 'Broken button', location: 'app.ts', citation: 'criterion', detail: 'bad',
  reproStep: 'click', status: 'fixed', openReason: null, failureReason: null, fixTicketId: 'tkt_2',
  resolvedBy: 'fix-ticket', resolutionNote: null, createdAt: 1,
}
const note: TestNote = {
  id: 'note_1', featureId: feature.id, text: 'Align the title', status: 'open', author: 'human', sentAt: 2,
  createdAt: 1, updatedAt: 2,
}
const input: OutcomeInput = {
  feature, tickets: [ticket(1, { digest: '## Surprises\n- None\n## Left undone\n- Nothing' }), ticket(2, { status: 'cancelled' }), review],
  findings: [finding], notes: [note], shippedAt: Date.parse('2026-09-05T12:00:00Z'),
  delta: { commits: 7, files: 12 },
  artifacts: [{ ticketId: review.id, seq: 3, passKind: 'verification', reviewedCommit: 'abc123', completedAt: 23, landedSince: 0 }],
}

describe('composeOutcomeDoc', () => {
  it('synthesizes shipped scale, the feature’s work, stamped review, and note disposition', () => {
    const doc = composeOutcomeDoc(input)
    expect(doc).toContain('- Shipped: 2026-09-05')
    expect(doc).not.toMatch(/\bLaps?\b/)
    expect(doc).toContain('7 commits · 12 files')
    expect(doc).toContain('- 1 tickets landed: #1 Ticket 1\n- 1 waived: #2 Ticket 2\n- 0 failed')
    expect(doc).toContain('### Ticket 3 · verification')
    expect(doc).toContain('- Reviewed commit: abc123\n- Landed since: 0')
    expect(doc).toContain('**Broken button** — fixed')
    expect(doc).toContain('Align the title — sent to the agent')
  })

  it('writes no ticket lines for a feature built by workers, and lists its workers', () => {
    const worker = { label: 'Add laps', kind: 'on-its-own', outcome: 'landed', status: 'landed', tokens: 900 } as unknown as WorkerRow
    const doc = composeOutcomeDoc({ ...input, tickets: [], artifacts: [], workers: [worker] })
    expect(doc).not.toContain('tickets landed')
    expect(doc).toContain('- Add laps (on-its-own) — landed · 900 tokens')
    expect(composeOutcomeDoc(input)).toContain('1 tickets landed')
  })

  it('records a feature reviewed by Review workers: each review’s mode and its findings with their status', () => {
    const reviewWorker = (id: string, overrides: Partial<WorkerRow>): WorkerRow =>
      ({ id, label: 'Review', kind: 'review', status: 'handed-back', outcome: null, tokens: null, reviewMode: 'drive', reviewVerify: null, ...overrides }) as WorkerRow
    const first = reviewWorker('wkr_r1', {})
    const verify = reviewWorker('wkr_r2', { label: 'Review: verify', reviewMode: 'gates', reviewVerify: { findingIds: ['finding_a'], commits: ['f00d123'] } })
    const reported = (id: string, reviewWorkerId: string, overrides: Partial<ReviewFinding>): ReviewFinding =>
      ({ ...finding, id, reviewTicketId: null, reviewWorkerId, fixTicketId: null, resolvedBy: null, ...overrides }) as ReviewFinding
    const findings = [
      reported('finding_a', first.id, { title: 'Theme resets', status: 'fixed', resolvedBy: 'session', resolutionNote: 'persisted in f00d123' }),
      reported('finding_b', first.id, { title: 'Copy typo', kind: 'observation', severity: 'low', status: 'dismissed', resolutionNote: 'intended wording' }),
      reported('finding_c', first.id, { title: 'Slow list', severity: 'medium', status: 'open' }),
    ]

    const doc = composeOutcomeDoc({ ...input, tickets: [], artifacts: [], workers: [first, verify], findings })

    expect(doc).not.toContain('No completed review pass')
    expect(doc).toContain('### Review · drive review\n\n- Outcome: handed-back')
    expect(doc).toContain('- **Theme resets** (defect, high) — fixed: persisted in f00d123')
    expect(doc).toContain('- **Copy typo** (observation, low) — dismissed: intended wording')
    expect(doc).toContain('- **Slow list** (defect, medium) — open')
    expect(doc).toContain('### Review: verify · gates review, verify\n\n- Outcome: handed-back\n- Verified fix commits: f00d123\n\n- No findings')
    // A feature with neither a review ticket nor a Review worker still says so.
    expect(composeOutcomeDoc({ ...input, tickets: [], artifacts: [], workers: [], findings: [] })).toContain('- No completed review pass')
  })

  it('drops digests containing only empty None/Nothing rows', () => {
    expect(digestHasSubstance('## Surprises\n- None\n## Left undone\n- Nothing')).toBe(false)
    expect(digestHasSubstance('## Surprises\n- A coupling mattered')).toBe(true)
    expect(composeOutcomeDoc(input)).not.toContain('## Per-ticket digests')
  })
})
