import type { Feature, Ticket } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { composeOutcomeDoc } from '../src/services/outcome'

/**
 * The outcome-doc composer (the-work-record ticket 3) — the feature's single new
 * seam, deliberately IO-free: feature + tickets in, markdown out, no git.
 */

const SHIPPED_AT = Date.parse('2026-08-11T09:30:00.000Z')

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feat_1',
    projectId: 'proj_1',
    slug: 'thick-record',
    title: 'The work record gets thick',
    oneLiner: 'burners write digests that survive the sandbox',
    mapped: false,
    lap: 1,
    phase: 'review',
    branch: 'feature/thick-record',
    status: 'active',
    createdAt: SHIPPED_AT,
    ...overrides,
  }
}

function ticket(seq: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: `tkt_${seq}`,
    featureId: 'feat_1',
    seq,
    title: `Ticket ${seq}`,
    goal: 'do the thing',
    context: 'somewhere',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    lap: 1,
    status: 'done',
    commits: [],
    ...overrides,
  }
}

describe('composeOutcomeDoc', () => {
  it('renders the feature header: title, one-liner, shipped date and lap', () => {
    const doc = composeOutcomeDoc(feature({ lap: 3 }), [], SHIPPED_AT)

    expect(doc).toContain('# Outcome — The work record gets thick')
    expect(doc).toContain('burners write digests that survive the sandbox')
    expect(doc).toContain('- Shipped: 2026-08-11T09:30:00.000Z')
    expect(doc).toContain('- Lap: 3')
  })

  it('gives each done ticket a numbered section carrying its digest', () => {
    const doc = composeOutcomeDoc(
      feature(),
      [ticket(1, { title: 'Add digest columns', digest: 'Added the columns.\nHarvest is best-effort.' })],
      SHIPPED_AT,
    )

    expect(doc).toContain('## 1. Add digest columns')
    expect(doc).toContain('Added the columns.\nHarvest is best-effort.')
  })

  it('marks a done ticket whose burner captured no digest', () => {
    const doc = composeOutcomeDoc(feature(), [ticket(1), ticket(2, { digest: '   ' })], SHIPPED_AT)

    expect(doc).toContain('## 1. Ticket 1\n\n_no digest captured_')
    expect(doc).toContain('## 2. Ticket 2\n\n_no digest captured_')
  })

  it('renders tickets in seq order regardless of the order passed in', () => {
    const doc = composeOutcomeDoc(
      feature(),
      [ticket(3), ticket(1), ticket(2)],
      SHIPPED_AT,
    )

    expect(doc.indexOf('## 1.')).toBeLessThan(doc.indexOf('## 2.'))
    expect(doc.indexOf('## 2.')).toBeLessThan(doc.indexOf('## 3.'))
  })

  it('reduces a failed ticket to one line carrying its status and error headline', () => {
    const doc = composeOutcomeDoc(
      feature(),
      [ticket(1, { status: 'failed', title: 'Wire the hook', error: 'agent gave up' })],
      SHIPPED_AT,
    )

    expect(doc).toContain('- **1. Wire the hook** — failed: agent gave up')
    expect(doc).not.toContain('## 1.')
  })

  it('takes the last fatal/error line of a noisy error as the headline', () => {
    const error = 'Preparing worktree (x)\nfatal: could not create leading directories\nnoise'
    const doc = composeOutcomeDoc(feature(), [ticket(1, { status: 'failed', error })], SHIPPED_AT)

    expect(doc).toContain('— failed: fatal: could not create leading directories')
  })

  it('truncates a headline too long to sit on one line', () => {
    const error = `fatal: ${'x'.repeat(400)}`
    const doc = composeOutcomeDoc(feature(), [ticket(1, { status: 'failed', error })], SHIPPED_AT)

    const line = doc.split('\n').find((l) => l.startsWith('- **1.')) ?? ''
    expect(line.length).toBeLessThan(200)
    expect(line.endsWith('…')).toBe(true)
  })

  it('gives a cancelled ticket a one-liner with no headline when it has no error', () => {
    const doc = composeOutcomeDoc(
      feature(),
      [ticket(1, { status: 'cancelled', title: 'Dropped work' })],
      SHIPPED_AT,
    )

    expect(doc).toContain('- **1. Dropped work** — cancelled')
  })

  it('keeps a run of non-done tickets in one tight list between digest sections', () => {
    const doc = composeOutcomeDoc(
      feature(),
      [
        ticket(1, { digest: 'did it' }),
        ticket(2, { status: 'failed', error: 'boom' }),
        ticket(3, { status: 'cancelled' }),
        ticket(4, { digest: 'did it too' }),
      ],
      SHIPPED_AT,
    )

    expect(doc).toContain('- **2. Ticket 2** — failed: boom\n- **3. Ticket 3** — cancelled')
    expect(doc.indexOf('## 1.')).toBeLessThan(doc.indexOf('- **2.'))
    expect(doc.indexOf('- **3.')).toBeLessThan(doc.indexOf('## 4.'))
  })

  it('is regenerated wholesale: the same inputs produce byte-identical markdown', () => {
    const tickets = [ticket(1, { digest: 'did it' }), ticket(2, { status: 'failed', error: 'boom' })]

    expect(composeOutcomeDoc(feature(), tickets, SHIPPED_AT)).toBe(
      composeOutcomeDoc(feature(), tickets, SHIPPED_AT),
    )
  })
})
