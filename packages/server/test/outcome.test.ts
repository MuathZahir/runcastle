import type { Feature, ReviewFinding, TestNote, Ticket } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { composeOutcomeDoc, digestHasSubstance, type OutcomeInput } from '../src/services/outcome'

const feature: Feature = {
  id: 'feat_1', projectId: 'proj_1', slug: 'record', title: 'A durable record',
  oneLiner: 'Evidence and state first.', mapped: false, lap: 2, phase: 'review',
  branch: 'feature/record', status: 'active', createdAt: 1,
}
const ticket = (seq: number, overrides: Partial<Ticket> = {}): Ticket => ({
  id: `tkt_${seq}`, featureId: feature.id, seq, title: `Ticket ${seq}`, goal: 'ship', context: '',
  acceptanceCriteria: [], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review',
  lap: seq === 1 ? 1 : 2, status: 'done', commits: [], reviewedCommit: null, completedAt: 20 + seq,
  ...overrides,
})
const review = ticket(3, { kind: 'review', passKind: 'verification', reviewedCommit: 'abc123' })
const finding: ReviewFinding = {
  id: 'finding_1', featureId: feature.id, lap: 2, reviewTicketId: review.id, kind: 'defect',
  severity: 'must-fix', title: 'Broken button', location: 'app.ts', citation: 'criterion', detail: 'bad',
  reproStep: 'click', status: 'fixed', openReason: null, failureReason: null, fixTicketId: 'tkt_2', createdAt: 1,
}
const note: TestNote = {
  id: 'note_1', featureId: feature.id, lap: 1, text: 'Align the title', status: 'carried', author: 'human',
  carriedLap: 2, createdAt: 1, updatedAt: 2,
}
const input: OutcomeInput = {
  feature, tickets: [ticket(1, { digest: '## Surprises\n- None\n## Left undone\n- Nothing' }), ticket(2, { status: 'cancelled' }), review],
  findings: [finding], notes: [note], shippedAt: Date.parse('2026-09-05T12:00:00Z'),
  delta: { commits: 7, files: 12 },
  artifacts: [{ ticketId: review.id, lap: 2, passKind: 'verification', reviewedCommit: 'abc123', completedAt: 23, landedSince: 0 }],
}

describe('composeOutcomeDoc', () => {
  it('synthesizes shipped scale, per-lap work, stamped review, and note disposition', () => {
    const doc = composeOutcomeDoc(input)
    expect(doc).toContain('- Shipped: 2026-09-05\n- Laps run: 2')
    expect(doc).toContain('7 commits · 12 files')
    expect(doc).toContain('### Lap 1\n- 1 tickets landed')
    expect(doc).toContain('### Lap 2\n- 0 tickets landed\n- 1 waived: #2 Ticket 2')
    expect(doc).toContain('### Lap 2 · verification')
    expect(doc).toContain('- Reviewed commit: abc123\n- Landed since: 0')
    expect(doc).toContain('**Broken button** — fixed')
    expect(doc).toContain('Align the title — carried → lap 2')
  })

  it('drops digests containing only empty None/Nothing rows', () => {
    expect(digestHasSubstance('## Surprises\n- None\n## Left undone\n- Nothing')).toBe(false)
    expect(digestHasSubstance('## Surprises\n- A coupling mattered')).toBe(true)
    expect(composeOutcomeDoc(input)).not.toContain('## Per-ticket digests')
  })
})
