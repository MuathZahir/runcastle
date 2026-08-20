import { describe, expect, it } from 'vitest'
import { parsePhase, Phase, Ticket, TicketInput } from '../src/schemas'

const validTicket = {
  title: 'Add health endpoint',
  goal: 'Expose GET /health returning ok',
  context: 'The server has no health check yet',
  acceptanceCriteria: ['GET /health returns 200', 'body is the string "ok"'],
  seams: ['routes/health.ts'],
  blockedBy: [],
}

describe('TicketInput — happy path', () => {
  it('accepts a well-formed ticket', () => {
    const r = TicketInput.safeParse(validTicket)
    expect(r.success).toBe(true)
  })

  it('accepts blockedBy referencing other seq numbers', () => {
    const r = TicketInput.safeParse({ ...validTicket, blockedBy: [1, 2] })
    expect(r.success).toBe(true)
  })

  it('defaults kind to implementation when the emitter omits it', () => {
    const r = TicketInput.safeParse(validTicket)
    expect(r.success && r.data.kind).toBe('implementation')
  })

  it('accepts an explicit review kind', () => {
    const r = TicketInput.safeParse({ ...validTicket, kind: 'review' })
    expect(r.success && r.data.kind).toBe('review')
  })

  it('leaves model unset when the emitter assigns none', () => {
    const r = TicketInput.safeParse(validTicket)
    expect(r.success && r.data.model).toBeUndefined()
  })

  it('accepts an assigned model id', () => {
    const r = TicketInput.safeParse({ ...validTicket, model: 'gpt-5.6-sol' })
    expect(r.success && r.data.model).toBe('gpt-5.6-sol')
  })
})

describe('TicketInput — failure cases', () => {
  it('rejects a missing title', () => {
    const bad = { ...validTicket } as Record<string, unknown>
    delete bad.title
    expect(TicketInput.safeParse(bad).success).toBe(false)
  })

  it('rejects a non-array acceptanceCriteria', () => {
    expect(
      TicketInput.safeParse({ ...validTicket, acceptanceCriteria: 'nope' }).success,
    ).toBe(false)
  })

  it('rejects non-number blockedBy entries', () => {
    expect(TicketInput.safeParse({ ...validTicket, blockedBy: ['1'] }).success).toBe(false)
  })

  it('rejects wrong-typed goal', () => {
    expect(TicketInput.safeParse({ ...validTicket, goal: 42 }).success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    expect(TicketInput.safeParse({ ...validTicket, kind: 'audit' }).success).toBe(false)
  })

  it('rejects a non-string model', () => {
    expect(TicketInput.safeParse({ ...validTicket, model: 7 }).success).toBe(false)
  })
})

describe('Ticket — stored shape', () => {
  it('requires persistence fields on top of TicketInput', () => {
    const stored = {
      ...validTicket,
      id: 'tkt_abc123',
      featureId: 'feat_xyz789',
      seq: 1,
      status: 'pending',
      lap: 1,
      commits: [],
    }
    expect(Ticket.safeParse(stored).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    const stored = {
      ...validTicket,
      id: 'tkt_abc123',
      featureId: 'feat_xyz789',
      seq: 1,
      status: 'exploded',
      commits: [],
    }
    expect(Ticket.safeParse(stored).success).toBe(false)
  })
})

describe('enums', () => {
  it('Phase accepts pipeline phases and rejects others', () => {
    expect(Phase.safeParse('ideation').success).toBe(true)
    expect(Phase.safeParse('shipped').success).toBe(true)
    expect(Phase.safeParse('bogus').success).toBe(false)
  })
})

describe('parsePhase — tolerant read of an unrecognized phase (findings F19)', () => {
  it('returns the phase for every value the pipeline knows', () => {
    expect(parsePhase('ideation')).toBe('ideation')
    expect(parsePhase('implementation')).toBe('implementation')
    expect(parsePhase('shipped')).toBe('shipped')
  })

  it('returns null for a phase name this build does not know', () => {
    expect(parsePhase('bogus')).toBeNull()
    expect(parsePhase('polish')).toBeNull()
  })

  it('returns null rather than throwing for a non-string value', () => {
    expect(parsePhase(undefined)).toBeNull()
    expect(parsePhase(null)).toBeNull()
    expect(parsePhase(7)).toBeNull()
    expect(parsePhase({ phase: 'ideation' })).toBeNull()
  })
})
