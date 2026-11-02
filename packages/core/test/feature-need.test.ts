import { describe, expect, it } from 'vitest'
import { HELD_NEED_GRACE_MS, YOU_STOPPED_IT, featureNeed, needPings, type NeedFacts, type WaitingKind } from '../src/feature-need'

/** you-always-know-what-s-waiting ticket 1: the one need a feature shows, from plain facts. */

const NOW = 10_000_000

function facts(over: Partial<NeedFacts> = {}): NeedFacts {
  return {
    status: 'active',
    held: false,
    agentWorking: false,
    waiting: null,
    leadAwaitsHuman: null,
    openAsk: null,
    conflictSince: null,
    declaration: null,
    latestRoundStartedAt: null,
    humanDriveEndedAt: null,
    humanMessageAt: null,
    driveConfigured: true,
    wakeFailed: null,
    wakeQueuedAt: null,
    ...over,
  }
}

const waiting = (reason: string, kind: WaitingKind | null = null, since = 5_000) =>
  ({ reason, kind, since })

const approval = { kind: 'approval' as const, title: 'Bash: git push', threadId: 'side_1', since: 7_000 }

describe('featureNeed', () => {
  it('needs nothing when nothing is waited on', () => {
    expect(featureNeed(facts(), NOW)).toBeNull()
  })

  it('needs nothing of a draft, a shipped or an archived feature', () => {
    for (const status of ['draft', 'shipped', 'archived'] as const) {
      expect(featureNeed(facts({ status, waiting: waiting('which model?') }), NOW)).toBeNull()
    }
  })

  it('reads an open approval as a permission need naming the call and its thread', () => {
    expect(featureNeed(facts({ openAsk: approval }), NOW)).toEqual({
      kind: 'permission', words: 'Needs permission · Bash: git push', why: 'Bash: git push', held: false, since: 7_000, threadId: 'side_1',
    })
  })

  it('reads a standing merge conflict', () => {
    expect(featureNeed(facts({ conflictSince: 6_000 }), NOW)).toMatchObject({ kind: 'conflict', words: 'Merge conflict', since: 6_000 })
  })

  it('reads a waiting reason with no kind, or kind answer, as an answer with the reason', () => {
    for (const kind of [null, 'answer'] as const) {
      expect(featureNeed(facts({ waiting: waiting('which model?', kind) }), NOW)).toMatchObject({
        kind: 'answer', words: 'Needs your answer · which model?', why: 'which model?', since: 5_000,
      })
    }
  })

  it('reads a lead that replied with no reason as an answer without a why', () => {
    const need = featureNeed(facts({ leadAwaitsHuman: { since: 4_000 } }), NOW)
    expect(need).toMatchObject({ kind: 'answer', words: 'Needs your answer', since: 4_000 })
    expect(need?.why).toBeUndefined()
  })

  it('reads an open question ask as an answer in its thread', () => {
    const ask = { kind: 'question' as const, title: 'Which database?', threadId: 'chat_1', since: 3_000 }
    expect(featureNeed(facts({ openAsk: ask, agentWorking: true }), NOW)).toMatchObject({
      kind: 'answer', words: 'Needs your answer · Which database?', threadId: 'chat_1',
    })
  })

  it('reads kind plan and kind design as their own needs', () => {
    expect(featureNeed(facts({ waiting: waiting('start round 1?', 'plan') }), NOW)).toMatchObject({ kind: 'plan', words: 'Plan to approve' })
    expect(featureNeed(facts({ waiting: waiting('look at the header', 'design') }), NOW)).toMatchObject({ kind: 'design', words: 'Design to approve' })
  })

  it('reads stuck, the human’s Stop, the provider’s limit and a stopped plan as Stopped', () => {
    const cases: Array<[NeedFacts['waiting'], string]> = [
      [waiting('the same test keeps failing', 'stuck'), 'Stopped · the same test keeps failing'],
      [waiting('stopped'), 'Stopped · you stopped it'],
      [waiting('provider limit'), 'Stopped · the provider’s limit'],
      [waiting('planning stopped'), 'Stopped · planning stopped'],
    ]
    for (const [w, words] of cases) expect(featureNeed(facts({ waiting: w }), NOW)).toMatchObject({ kind: 'stopped', words })
  })

  it('reads a failed wake newer than the last round and the last queued message as Stopped', () => {
    const failed = facts({ wakeFailed: { at: 8_000, exitCode: 1 }, wakeQueuedAt: 7_500, latestRoundStartedAt: 2_000 })
    expect(featureNeed(failed, NOW)).toMatchObject({ kind: 'stopped', words: 'Stopped · the agent’s run failed (exit 1)', since: 8_000 })
    expect(featureNeed({ ...failed, wakeQueuedAt: 9_000 }, NOW)).toBeNull()
    expect(featureNeed({ ...failed, latestRoundStartedAt: 9_000 }, NOW)).toBeNull()
  })

  describe('ready to test or to merge', () => {
    const declared = facts({ waiting: waiting('ready to test'), declaration: { scenario: 'checkout', at: 5_000 }, latestRoundStartedAt: 1_000 })

    it('is Ready to test until the human drives it', () => {
      expect(featureNeed(declared, NOW)).toMatchObject({ kind: 'test', words: 'Ready to test · checkout', scenario: 'checkout', since: 5_000 })
    })

    it('is Ready to merge once a human drive ended after the declaration with no message since', () => {
      expect(featureNeed({ ...declared, humanDriveEndedAt: 6_000, humanMessageAt: 4_000 }, NOW)).toMatchObject({
        kind: 'merge', words: 'Ready to merge', since: 6_000,
      })
    })

    it('stays Ready to test when the drive came before the declaration, or notes followed it', () => {
      expect(featureNeed({ ...declared, humanDriveEndedAt: 4_000 }, NOW)).toMatchObject({ kind: 'test' })
      expect(featureNeed({ ...declared, humanDriveEndedAt: 6_000, humanMessageAt: 6_500 }, NOW)).toMatchObject({ kind: 'test' })
    })

    it('goes straight to Ready to merge in a project with no drive set up', () => {
      expect(featureNeed({ ...declared, driveConfigured: false }, NOW)).toMatchObject({ kind: 'merge', since: 5_000 })
    })

    it('is not ready once a newer round started, nor while the agent works', () => {
      expect(featureNeed({ ...declared, waiting: null, latestRoundStartedAt: 6_000 }, NOW)).toBeNull()
      expect(featureNeed({ ...declared, agentWorking: true }, NOW)).toBeNull()
    })

    it('is ready, not an answer, when the lead replied after declaring', () => {
      expect(featureNeed({ ...declared, waiting: null, leadAwaitsHuman: { since: 5_500 } }, NOW)).toMatchObject({ kind: 'test' })
    })
  })

  it('counts only an open ask and a conflict while the agent works', () => {
    const busy = facts({ agentWorking: true, waiting: waiting('which model?'), leadAwaitsHuman: { since: 1 } })
    expect(featureNeed(busy, NOW)).toBeNull()
    expect(featureNeed({ ...busy, conflictSince: 2_000 }, NOW)).toMatchObject({ kind: 'conflict' })
    expect(featureNeed({ ...busy, openAsk: approval }, NOW)).toMatchObject({ kind: 'permission' })
  })

  it('shows the most pressing need: permission, conflict, answer, plan, design, stopped, test, merge', () => {
    const ready = { declaration: { scenario: 'checkout', at: 5_000 }, driveConfigured: false }
    const ladder: Array<[Partial<NeedFacts>, string]> = [
      [{ ...ready, waiting: waiting('stopped'), conflictSince: 1, openAsk: approval }, 'permission'],
      [{ ...ready, waiting: waiting('which model?'), conflictSince: 1 }, 'conflict'],
      [{ ...ready, waiting: waiting('which model?') }, 'answer'],
      [{ ...ready, waiting: waiting('go?', 'plan') }, 'plan'],
      [{ ...ready, waiting: waiting('look', 'design') }, 'design'],
      [{ ...ready, waiting: waiting('stopped') }, 'stopped'],
      [{ ...ready, driveConfigured: true }, 'test'],
      [ready, 'merge'],
    ]
    for (const [over, kind] of ladder) expect(featureNeed(facts(over), NOW)?.kind).toBe(kind)
  })

  describe('held by an orchestrator', () => {
    const since = NOW - 10 * 60_000

    it('holds an answer, a plan, a stop, a conflict and the ready needs for an hour', () => {
      const cases: Array<Partial<NeedFacts>> = [
        { waiting: waiting('which model?', null, since) },
        { waiting: waiting('go?', 'plan', since) },
        { waiting: waiting('stopped', null, since) },
        { conflictSince: since },
        { declaration: { scenario: 'checkout', at: since } },
        { declaration: { scenario: 'checkout', at: since }, driveConfigured: false },
      ]
      for (const over of cases) {
        const need = featureNeed(facts({ ...over, held: true }), NOW)
        expect(need?.held).toBe(true)
        expect(need?.words.startsWith('With the orchestrator · ')).toBe(true)
      }
      expect(featureNeed(facts({ held: true, waiting: waiting('go?', 'plan', since) }), NOW)?.words).toBe('With the orchestrator · Plan to approve')
    })

    it('hands a held need to the human once it has waited an hour', () => {
      const old = facts({ held: true, waiting: waiting('go?', 'plan', NOW - HELD_NEED_GRACE_MS) })
      expect(featureNeed(old, NOW)).toMatchObject({ kind: 'plan', words: 'Plan to approve', held: false })
      expect(featureNeed(old, NOW - 1)).toMatchObject({ held: true })
    })

    it('never holds a permission prompt or a design', () => {
      expect(featureNeed(facts({ held: true, openAsk: { ...approval, since } }), NOW)).toMatchObject({ kind: 'permission', held: false, words: 'Needs permission · Bash: git push' })
      expect(featureNeed(facts({ held: true, waiting: waiting('look', 'design', since) }), NOW)).toMatchObject({ kind: 'design', held: false, words: 'Design to approve' })
    })
  })
})

/** Ticket 3: the one rule the desktop ping and the phone push share. */
describe('needPings', () => {
  const need = { kind: 'plan', words: 'Plan to approve', held: false, why: null }

  it('pings for a need that is not held', () => {
    expect(needPings(need)).toBe(true)
    expect(needPings({ kind: 'stopped', words: 'Stopped · the provider’s limit', held: false, why: 'the provider’s limit' })).toBe(true)
  })

  it('stays quiet for a held need, and for the stop the human made', () => {
    expect(needPings({ ...need, held: true, words: 'With the orchestrator · Plan to approve' })).toBe(false)
    expect(needPings({ kind: 'stopped', words: 'Stopped · you stopped it', held: false, why: YOU_STOPPED_IT })).toBe(false)
  })

  it('never pings for malformed data', () => {
    expect(needPings(undefined)).toBe(false)
    expect(needPings({ kind: 'nap', words: 'x', held: false })).toBe(false)
    expect(needPings({ kind: 'plan', held: false })).toBe(false)
    expect(needPings({ kind: 'plan', words: 'x' })).toBe(false)
  })
})
