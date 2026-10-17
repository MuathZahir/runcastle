import type { EventRow, RoundSummary } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import {
  codeLandings,
  groupByRound,
  latestRoundTickets,
  roundAccount,
  roundAccountLine,
  roundTrail,
} from '../src/lib/feature-ui/rounds'

/**
 * The round trail (`the-feature-lead-runs-rounds` decision 16): every run is a
 * round, numbered from its runs, with the agent's own fixes and its ready
 * declarations placed after the round they follow.
 */
const round = (over: Partial<RoundSummary> & Pick<RoundSummary, 'round' | 'runId'>): RoundSummary => ({
  status: 'succeeded',
  ticketSeqs: [],
  landed: [],
  failed: [],
  gates: null,
  tokens: null,
  startedAt: 1000 * over.round,
  finishedAt: 1000 * over.round + 600,
  ...over,
})

const ticket = (seq: number, status = 'done', over: Record<string, unknown> = {}) => ({
  id: `t${seq}`,
  seq,
  title: `pricing: task ${seq}`,
  status,
  ...over,
})

const event = (over: Partial<EventRow>): EventRow => ({
  id: 1,
  projectId: 'p1',
  featureId: 'f1',
  ts: 0,
  type: 'lead.code_landed',
  message: '',
  ...over,
})

describe('roundTrail', () => {
  const rounds = [
    round({ round: 1, runId: 'r1', ticketSeqs: [1, 2], landed: [1, 2], tokens: 1_100_000, gates: { ok: true, failed: [] } }),
    round({ round: 2, runId: 'r2', ticketSeqs: [3], landed: [], failed: [3], gates: { ok: false, failed: ['bun test'] } }),
  ]
  const tickets = [ticket(1), ticket(2), ticket(3, 'failed'), ticket(4, 'pending'), ticket(5, 'cancelled')]

  it('numbers rounds from runs and lists each one’s workers, counts, gates, tokens and duration', () => {
    const { entries } = roundTrail(rounds, tickets, [], [], [{ id: 'r1', summary: 'Pricing landed.' }])
    expect(entries).toEqual([
      {
        type: 'round',
        round: 1,
        runId: 'r1',
        status: 'succeeded',
        workers: [tickets[0], tickets[1]],
        landed: 2,
        failed: 0,
        gates: { ok: true, failed: [] },
        tokens: 1_100_000,
        durationMs: 600,
        verdict: 'Pricing landed.',
      },
      {
        type: 'round',
        round: 2,
        runId: 'r2',
        status: 'succeeded',
        workers: [tickets[2]],
        landed: 0,
        failed: 1,
        gates: { ok: false, failed: ['bun test'] },
        tokens: null,
        durationMs: 600,
        verdict: null,
      },
    ])
  })

  it('a running round has no duration yet', () => {
    const { entries } = roundTrail([round({ round: 1, runId: 'r1', status: 'running', finishedAt: null })], [], [])
    expect(entries[0]).toMatchObject({ type: 'round', status: 'running', durationMs: null })
  })

  it('places an agent fix and a ready declaration right after the round they follow, in the order they happened', () => {
    const landings = codeLandings([
      event({ id: 1, ts: 1700, data: { commits: [{ sha: 'abc1234def', subject: 'feat(pricing): rename field' }], files: ['a.ts'], afterRunId: 'r1' } }),
    ])
    const { entries } = roundTrail(rounds, tickets, [
      { runId: 'r2', scenario: 'Apply a coupon', whatToTest: 'Check the total.', createdAt: 3000 },
      { runId: 'r1', scenario: 'Early drive', whatToTest: 'Look around.', createdAt: 1800 },
    ], landings)
    expect(entries.map((e) => (e.type === 'round' ? `round ${e.round}` : e.type))).toEqual([
      'round 1',
      'agent-fix',
      'ready',
      'round 2',
      'ready',
    ])
    expect(entries[1]).toEqual({ type: 'agent-fix', commits: [{ sha: 'abc1234def', subject: 'feat(pricing): rename field' }], files: ['a.ts'] })
    expect(entries[2]).toEqual({ type: 'ready', scenario: 'Early drive', whatToTest: 'Look around.', afterRound: 1 })
    expect(entries[4]).toMatchObject({ type: 'ready', scenario: 'Apply a coupon', afterRound: 2 })
  })

  it('puts what came before any round first', () => {
    const landings = codeLandings([event({ data: { commits: [{ sha: 'a1', subject: 'fix' }], files: [], afterRunId: null } })])
    const { entries } = roundTrail(rounds, tickets, [{ runId: null, scenario: 's', whatToTest: 'w', createdAt: 1 }], landings)
    expect(entries.slice(0, 2).map((e) => e.type)).toEqual(['agent-fix', 'ready'])
    expect(entries[1]).toMatchObject({ afterRound: null })
  })

  it('works with no code landings at all', () => {
    expect(roundTrail(rounds, tickets, []).entries.map((e) => e.type)).toEqual(['round', 'round'])
  })

  it('lists pending tickets no round has held as not yet dispatched', () => {
    expect(roundTrail(rounds, tickets, []).notDispatched.map((t) => t.seq)).toEqual([4])
  })
})

describe('codeLandings', () => {
  it('reads only well-formed lead.code_landed events', () => {
    expect(
      codeLandings([
        event({ type: 'run.finished', data: { commits: [{ sha: 'x', subject: 'y' }] } }),
        event({ data: { commits: [] } }),
        event({ data: 'nonsense' }),
        event({ ts: 9, data: { commits: [{ sha: 'abc', subject: 'feat: x' }], afterRunId: 'r1' } }),
      ]),
    ).toEqual([{ commits: [{ sha: 'abc', subject: 'feat: x' }], files: [], afterRunId: 'r1', at: 9 }])
  })
})

describe('groupByRound', () => {
  it('groups tickets by the round that last ran them, not-yet-dispatched last', () => {
    const groups = groupByRound(
      [ticket(1), ticket(2), ticket(3), ticket(4, 'pending')],
      [
        { round: 1, ticketSeqs: [1, 2] },
        { round: 2, ticketSeqs: [2, 3] },
      ],
    )
    expect(groups.map((g) => [g.round, g.rows.map((t) => t.seq)])).toEqual([
      [1, [1]],
      [2, [2, 3]],
      [null, [4]],
    ])
  })

  it('is one undispatched group before any round', () => {
    expect(groupByRound([ticket(1, 'pending')], [])).toEqual([{ round: null, rows: [ticket(1, 'pending')] }])
  })
})

describe('roundAccount', () => {
  it('reads the latest round’s review digest as the account', () => {
    const tickets = [
      ticket(1, 'done', { kind: 'review', digest: 'Round 1: old review' }),
      ticket(2, 'done', { digest: 'did pricing' }),
      ticket(3, 'done', { kind: 'review', digest: 'Round 2: the coupons work · 2 landed' }),
    ]
    const latest = latestRoundTickets(tickets, [
      { ticketSeqs: [1] },
      { ticketSeqs: [2, 3] },
    ])
    const account = roundAccount(latest)
    expect(account).toEqual({ source: 'review', prose: 'Round 2: the coupons work · 2 landed' })
    expect(roundAccountLine(account)).toBe('The coupons work')
  })

  it('falls back to the workers’ digests when no review wrote one', () => {
    expect(roundAccount([ticket(2, 'done', { digest: ' did pricing ' })])).toEqual({
      source: 'tickets',
      entries: [{ seq: 2, title: 'pricing: task 2', digest: 'did pricing' }],
    })
  })
})
