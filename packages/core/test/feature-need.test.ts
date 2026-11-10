import { describe, expect, it } from 'vitest'
import { HELD_NEED_GRACE_MS, YOU_STOPPED_IT, featureNeed, handbackLine, needPings, type NeedFacts, type WaitingKind } from '../src/feature-need'

/** you-always-know-what-s-waiting ticket 1: the one need a feature shows, from plain facts. */

const NOW = 10_000_000

function facts(over: Partial<NeedFacts> = {}): NeedFacts {
  return {
    status: 'active',
    owner: null,
    askingChat: null,
    agentWorking: false,
    workersAtWork: false,
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
    designsWaiting: 0,
    oldestDesignWaitingSince: null,
    workerNeedsYou: null,
    handback: null,
    ...over,
  }
}

const waiting = (reason: string, kind: WaitingKind | null = null, since = 5_000) =>
  ({ reason, kind, since })

const approval = { kind: 'approval' as const, title: 'Bash: git push', threadId: 'side_1', since: 7_000 }

/** An owner chat that is neither asking about the feature nor working. */
const CHAT = { chat: 'Notes triage', asking: false, working: false }

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

  it('names a worker that needs the human, opening its thread, even while the lead works and on a held feature', () => {
    const worker = { label: 'Header', threadId: 'sess_w', since: 8_000 }
    expect(featureNeed(facts({ workerNeedsYou: worker, agentWorking: true, owner: CHAT, handback: { at: 1, summary: "x" }, waiting: waiting('which model?') }), NOW)).toEqual({
      kind: 'worker',
      words: 'Header needs you',
      why: 'Header',
      since: 8_000,
      threadId: 'sess_w',
      held: false,
    })
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
    expect(need).toMatchObject({ kind: 'answer', words: 'Needs your answer', since: 4_000, quiet: true })
    expect(need?.why).toBeUndefined()
  })

  it('keeps an answer the lead asked for out loud from being quiet', () => {
    expect(featureNeed(facts({ waiting: waiting('which model?'), leadAwaitsHuman: { since: 4_000 } }), NOW)?.quiet).toBeUndefined()
  })

  it('reads an open question ask as an answer in its thread', () => {
    const ask = { kind: 'question' as const, title: 'Which database?', threadId: 'chat_1', since: 3_000 }
    expect(featureNeed(facts({ openAsk: ask, agentWorking: true }), NOW)).toMatchObject({
      kind: 'answer', words: 'Needs your answer · Which database?', threadId: 'chat_1',
    })
  })

  it('reads kind plan and kind design as their own needs', () => {
    expect(featureNeed(facts({ waiting: waiting('start round 1?', 'plan') }), NOW)).toMatchObject({ kind: 'plan', words: 'Plan to approve' })
    expect(featureNeed(facts({ waiting: waiting('look at the header', 'design'), designsWaiting: 1 }), NOW)).toMatchObject({ kind: 'design', words: 'Design to approve', since: 5_000 })
  })

  it('reads a design wait with no recorded design waiting as an answer with its reason (small-fixes decision 3)', () => {
    // A README banner shown as a file: nothing in the Design tab to approve.
    expect(featureNeed(facts({ waiting: waiting('banner to approve', 'design') }), NOW)).toEqual({
      kind: 'answer', words: 'Needs your answer · banner to approve', why: 'banner to approve', held: false, since: 5_000,
    })
    // An answer like any other: it pings, and under a chat owner it is the chat's.
    const held = featureNeed(facts({ owner: CHAT, waiting: waiting('banner to approve', 'design') }), NOW)
    expect(held).toMatchObject({ kind: 'answer', held: true, words: 'With Notes triage · Needs your answer · banner to approve' })
    expect(needPings(featureNeed(facts({ waiting: waiting('banner to approve', 'design') }), NOW))).toBe(true)
  })

  it('reads a design waiting in the record as a design need with no wait_for_you, since the oldest was shown, and not while the lead works', () => {
    const designs = { designsWaiting: 2, oldestDesignWaitingSince: 4_000 }
    expect(featureNeed(facts(designs), NOW)).toEqual({ kind: 'design', words: 'Design to approve', held: false, since: 4_000 })
    expect(featureNeed(facts({ ...designs, agentWorking: true }), NOW)).toBeNull()
    // Held under a chat owner (every-feature-has-one-owner decision 16).
    expect(featureNeed(facts({ ...designs, owner: CHAT }), NOW)).toMatchObject({ kind: 'design', held: true, words: 'With Notes triage · Design to approve' })
    // A plan the lead waits on still comes first.
    expect(featureNeed(facts({ ...designs, waiting: waiting('start round 1?', 'plan') }), NOW)).toMatchObject({ kind: 'plan' })
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
      [{ ...ready, waiting: waiting('look', 'design'), designsWaiting: 1 }, 'design'],
      [{ ...ready, waiting: waiting('stopped') }, 'stopped'],
      [{ ...ready, driveConfigured: true }, 'test'],
      [ready, 'merge'],
    ]
    for (const [over, kind] of ladder) expect(featureNeed(facts(over), NOW)?.kind).toBe(kind)
  })

  /** every-feature-has-one-owner decisions 15–17, 20: who owns the feature decides who has the need. */
  describe('by owner', () => {
    const recent = { at: NOW - 10 * 60_000, summary: 'Ready to test: the header is done.\nDetails follow.' }
    const stale = { ...recent, at: NOW - HELD_NEED_GRACE_MS }
    const asking = { ...CHAT, asking: true }
    const working = { ...CHAT, working: true }
    const old = recent.at - 1_000

    /** Every need kind but the handback itself, with its plain words. */
    const NEEDS: Array<[string, Partial<NeedFacts>, string, string]> = [
      ['permission', { openAsk: { ...approval, since: old } }, 'permission', 'Needs permission · Bash: git push'],
      ['conflict', { conflictSince: old }, 'conflict', 'Merge conflict'],
      ['worker', { workerNeedsYou: { label: 'Header', threadId: 'w', since: old } }, 'worker', 'Header needs you'],
      ['question ask', { openAsk: { kind: 'question', title: 'Which?', threadId: 'chat_1', since: old } }, 'answer', 'Needs your answer · Which?'],
      ['answer wait', { waiting: waiting('which model?', 'answer', old) }, 'answer', 'Needs your answer · which model?'],
      ['plan wait', { waiting: waiting('go?', 'plan', old) }, 'plan', 'Plan to approve'],
      ['design', { designsWaiting: 1, oldestDesignWaitingSince: old }, 'design', 'Design to approve'],
      ['stopped', { waiting: waiting('stopped', null, old) }, 'stopped', 'Stopped · you stopped it'],
      ['ready to test', { declaration: { scenario: 'checkout', at: old } }, 'test', 'Ready to test · checkout'],
      ['ready to merge', { declaration: { scenario: 'checkout', at: old }, driveConfigured: false }, 'merge', 'Ready to merge'],
    ]
    const onlyFeature = (kind: string) => kind === 'permission' || kind === 'worker'

    /** [scenario, facts, how it reads: plain (the human's), held behind the chat's words, or held "asking you"] */
    const SCENARIOS: Array<[string, Partial<NeedFacts>, 'plain' | 'held' | 'asking']> = [
      ['the human owns it', {}, 'plain'],
      ['the human owns it, its handback out to its chat', { handback: recent, askingChat: 'Notes triage' }, 'plain'],
      ['a chat owns it, no handback', { owner: CHAT }, 'held'],
      ['a chat owns it, a handback out', { owner: CHAT, handback: recent }, 'held'],
      ['a chat owns it, a handback out, the chat asking about it', { owner: asking, handback: recent }, 'asking'],
      ['a chat owns it, the chat asking about it but no handback', { owner: asking }, 'held'],
      ['a chat owns it, the chat quiet past the hour', { owner: CHAT, handback: stale }, 'plain'],
      ['a chat owns it, the chat working past the hour', { owner: working, handback: stale }, 'held'],
      ['a chat owns it, the chat asking past the hour', { owner: asking, handback: stale }, 'asking'],
    ]

    for (const [scenario, base, reads] of SCENARIOS) {
      describe(scenario, () => {
        it.each(NEEDS)('%s', (_, over, kind, words) => {
          const need = featureNeed(facts({ ...base, ...over }), NOW)
          const plain = reads === 'plain' || onlyFeature(kind)
          const expected = plain ? words : reads === 'asking' ? 'With Notes triage · asking you' : `With Notes triage · ${words}`
          expect(need).toMatchObject({ kind, held: !plain, words: expected })
          expect(needPings(need)).toBe(plain && !(kind === 'stopped'))
        })
      })
    }

    it('reads a chat-owned handback as With <Chat> · its line within the hour, and no ping', () => {
      const need = featureNeed(facts({ owner: CHAT, handback: recent }), NOW)
      expect(need).toEqual({
        kind: 'handback',
        words: 'With Notes triage · Ready to test: the header is done',
        why: 'Ready to test: the header is done',
        held: true,
        since: recent.at,
      })
      expect(needPings(need)).toBe(false)
    })

    it('reads it as With <Chat> · asking you while the chat asks about it', () => {
      expect(featureNeed(facts({ owner: asking, handback: recent }), NOW)).toMatchObject({ kind: 'handback', held: true, words: 'With Notes triage · asking you' })
    })

    it('brings it back as Handed back under Needs you once the chat has been quiet an hour, and only then', () => {
      const late = featureNeed(facts({ owner: CHAT, handback: stale }), NOW)
      expect(late).toMatchObject({ kind: 'handback', held: false, words: 'Handed back · Ready to test: the header is done' })
      expect(needPings(late)).toBe(true)
      expect(featureNeed(facts({ owner: working, handback: stale }), NOW)).toMatchObject({ held: true, words: 'With Notes triage · Ready to test: the header is done' })
      expect(featureNeed(facts({ owner: asking, handback: stale }), NOW)).toMatchObject({ held: true, words: 'With Notes triage · asking you' })
    })

    it('reads a human-owned feature asking its chat as Asking <Chat> · its line, held, never past the hour', () => {
      for (const handback of [recent, stale]) {
        const need = featureNeed(facts({ handback, askingChat: 'Notes triage' }), NOW)
        expect(need).toMatchObject({ kind: 'handback', held: true, words: 'Asking Notes triage · Ready to test: the header is done' })
        expect(needPings(need)).toBe(false)
      }
      expect(featureNeed(facts({ handback: { at: 1, summary: ' ' }, askingChat: 'Notes triage' }), NOW)?.words).toBe('Asking Notes triage')
    })

    it('reads a human-owned handback with no chat to ask as Handed back, as before', () => {
      expect(featureNeed(facts({ handback: recent }), NOW)).toMatchObject({ kind: 'handback', held: false, words: 'Handed back · Ready to test: the header is done' })
    })

    it('holds a bare reply under a chat owner, and leaves the human’s as it was', () => {
      expect(featureNeed(facts({ leadAwaitsHuman: { since: old } }), NOW)).toMatchObject({ kind: 'answer', held: false, words: 'Needs your answer', quiet: true })
      expect(featureNeed(facts({ owner: CHAT, leadAwaitsHuman: { since: old } }), NOW)).toMatchObject({ kind: 'answer', held: true, words: 'With Notes triage · Needs your answer' })
    })

    it('shows nothing while the lead works, whatever the chat does', () => {
      expect(featureNeed(facts({ owner: asking, handback: recent, agentWorking: true }), NOW)).toBeNull()
    })

    it('lets what only the feature can answer outrank a held need', () => {
      expect(featureNeed(facts({ owner: CHAT, conflictSince: old, workerNeedsYou: { label: 'Header', threadId: 'w', since: old } }), NOW)).toMatchObject({ kind: 'worker', held: false })
      // Among held needs, the usual order: the conflict before the handback.
      expect(featureNeed(facts({ owner: CHAT, handback: recent, conflictSince: old }), NOW)).toMatchObject({ kind: 'conflict', held: true })
    })
  })

  describe('handbackLine', () => {
    it('reads the first line, cut at its first sentence, clipped', () => {
      expect(handbackLine('\n  Blocked on a conflict in api.ts. I tried rebasing.\nMore')).toBe('Blocked on a conflict in api.ts')
      expect(handbackLine('Merge now? It is green.')).toBe('Merge now?')
      expect(handbackLine('v1.2 shipped')).toBe('v1.2 shipped')
      expect(handbackLine('x'.repeat(200))).toHaveLength(80)
      expect(featureNeed(facts({ handback: { at: 1, summary: '  ' } }), NOW)?.words).toBe('Handed back')
    })
  })
})

/** triage-batch decisions 13, 14: workers at work count as work; a real wait still wins. */
describe('featureNeed with workers at work', () => {
  const replied = { leadAwaitsHuman: { since: 4_000 }, workersAtWork: true }

  it('gives no need for a lead that replied while its workers work or wait to start', () => {
    expect(featureNeed(facts(replied), NOW)).toBeNull()
    expect(featureNeed(facts({ ...replied, owner: CHAT }), NOW)).toBeNull()
  })

  it('still gives the lead’s own wait_for_you, plan included', () => {
    expect(featureNeed(facts({ ...replied, waiting: waiting('which model?') }), NOW)).toMatchObject({
      kind: 'answer', words: 'Needs your answer · which model?', held: false,
    })
    expect(featureNeed(facts({ ...replied, waiting: waiting('plan', 'plan') }), NOW)).toMatchObject({ kind: 'plan' })
  })

  it('still gives an open question box and a permission prompt', () => {
    const ask = { kind: 'question' as const, title: 'Which database?', threadId: 'chat_1', since: 3_000 }
    expect(featureNeed(facts({ ...replied, openAsk: ask }), NOW)).toMatchObject({ kind: 'answer', threadId: 'chat_1' })
    expect(featureNeed(facts({ ...replied, openAsk: approval }), NOW)).toMatchObject({ kind: 'permission' })
  })

  it('still gives a worker that needs the human', () => {
    const worker = { label: 'Honest statuses', threadId: 'wk_1', since: 6_000 }
    expect(featureNeed(facts({ ...replied, workerNeedsYou: worker }), NOW)).toMatchObject({
      kind: 'worker', words: 'Honest statuses needs you', threadId: 'wk_1',
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
    expect(needPings({ ...need, held: true, words: 'With Notes triage · Plan to approve' })).toBe(false)
    expect(needPings({ kind: 'stopped', words: 'Stopped · you stopped it', held: false, why: YOU_STOPPED_IT })).toBe(false)
  })

  it('stays quiet for a bare reply, which only shows and counts', () => {
    expect(needPings({ kind: 'answer', words: 'Needs your answer', held: false, why: null, quiet: true })).toBe(false)
  })

  it('never pings for malformed data', () => {
    expect(needPings(undefined)).toBe(false)
    expect(needPings({ kind: 'nap', words: 'x', held: false })).toBe(false)
    expect(needPings({ kind: 'plan', held: false })).toBe(false)
    expect(needPings({ kind: 'plan', words: 'x' })).toBe(false)
  })
})
