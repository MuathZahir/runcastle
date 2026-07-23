import { describe, expect, it } from 'vitest'
import { Phase, Ticket, TicketInput } from '../src/schemas'

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
})

describe('Ticket — stored shape', () => {
  it('requires persistence fields on top of TicketInput', () => {
    const stored = {
      ...validTicket,
      id: 'tkt_abc123',
      featureId: 'feat_xyz789',
      seq: 1,
      status: 'pending',
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
