import { describe, expect, it } from 'vitest'
import { type Need, needPings, newestNeed, isReadyToTestWhy, readyToTestWhy, wakeFailedWhy } from '../src/feature-need'

/** needs-you-is-the-agent-s-call: a feature's need is the newest of its chats' waits. */

const need = (why: string, since: number, threadId = 'chat_1', by: Need['by'] = 'agent'): Need => ({ why, since, threadId, by })

describe('newestNeed', () => {
  it('needs nothing when no chat waits', () => {
    expect(newestNeed([])).toBeNull()
    expect(newestNeed([null, undefined])).toBeNull()
  })

  it('picks the newest wait, whichever chat it is in', () => {
    const lead = need('Which model?', 5_000, 'chat_1')
    const worker = need('Is the API key in the vault?', 7_000, 'wrk_1')
    const ask = need('Bash: git push', 6_000, 'chat_1')
    expect(newestNeed([lead, null, worker, ask])).toEqual(worker)
    expect(newestNeed([lead, ask])).toEqual(ask)
  })

  it('keeps runcastle’s own line for a dead run', () => {
    const dead = need(wakeFailedWhy(1), 9_000, 'chat_1', 'runcastle')
    expect(newestNeed([need('Which model?', 5_000), dead])).toEqual({ why: 'The agent’s run failed (exit 1)', since: 9_000, threadId: 'chat_1', by: 'runcastle' })
  })
})

describe('the fixed lines', () => {
  it('reads a ready declaration and a dead run', () => {
    expect(readyToTestWhy('Sign in with a magic link')).toBe('Ready to test · Sign in with a magic link')
    expect(wakeFailedWhy(null)).toBe('The agent’s run failed')
  })
})

describe('needPings', () => {
  it('pings every well-formed needs_you event', () => {
    expect(needPings({ why: 'Which model?', threadId: 'chat_1', by: 'agent', featureId: 'feat_1' })).toBe(true)
    expect(needPings({ why: 'Pick an order', threadId: 'proj_1', by: 'agent', featureId: null })).toBe(true)
    expect(needPings({ why: 'Usage limit reached', threadId: 'chat_1', by: 'runcastle', featureId: 'feat_1' })).toBe(true)
  })

  it('never pings malformed data', () => {
    expect(needPings(null)).toBe(false)
    expect(needPings('needs you')).toBe(false)
    expect(needPings({ why: 'x', threadId: 'chat_1', by: 'someone', featureId: null })).toBe(false)
    expect(needPings({ why: 'x', by: 'agent', featureId: null })).toBe(false)
    // The old shape, with a kind and no thread, is not one.
    expect(needPings({ kind: 'answer', words: 'Needs your answer', held: false, why: null })).toBe(false)
  })
})

describe('isReadyToTestWhy (a-calmer-sidebar decision 10: the sidebar tells "go test" from "go answer")', () => {
  it('reads declare_ready’s line, with or without a scenario, as ready to test', () => {
    expect(isReadyToTestWhy(readyToTestWhy('Sign in with a magic link'))).toBe(true)
    expect(isReadyToTestWhy('Ready to test')).toBe(true)
  })

  it('reads anything else as a question, even one that mentions testing', () => {
    expect(isReadyToTestWhy('Ready to testify?')).toBe(false)
    expect(isReadyToTestWhy('Which test runner?')).toBe(false)
    expect(isReadyToTestWhy(wakeFailedWhy(1))).toBe(false)
  })
})
