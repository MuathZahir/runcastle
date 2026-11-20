import { describe, expect, it } from 'vitest'
import { isUsageLimitNotice, isUsageLimitText } from '../src/provider-halt'

describe('isUsageLimitText', () => {
  it('knows the account usage limit as the runtimes word it, and nothing else', () => {
    expect(isUsageLimitText("Internal error: You've hit your 5-hour limit · resets 8pm (Europe/Berlin)")).toBe(true)
    expect(isUsageLimitText("You've hit your weekly limit")).toBe(true)
    expect(isUsageLimitText('Claude AI usage limit reached|1793903839')).toBe(true)
    expect(isUsageLimitText('rate limit exceeded (429), retrying')).toBe(false)
    expect(isUsageLimitText('insufficient_quota')).toBe(false)
    expect(isUsageLimitText('Internal error: connection reset')).toBe(false)
  })
})

describe('isUsageLimitNotice', () => {
  it('knows a reply that is the limit notice itself', () => {
    expect(isUsageLimitNotice("You've hit your 5-hour limit · resets 8pm (Europe/Berlin)")).toBe(true)
    expect(isUsageLimitNotice("  You’ve hit your weekly limit · resets Nov 24, 9am\n")).toBe(true)
    expect(isUsageLimitNotice('Claude AI usage limit reached|1793903839')).toBe(true)
    expect(isUsageLimitNotice("You've hit your usage limit. Upgrade to Pro or try again in 2 hours.")).toBe(true)
    expect(isUsageLimitNotice("API Error: You've hit your 5-hour limit")).toBe(true)
  })

  it('leaves a reply that only talks about the limit alone', () => {
    expect(isUsageLimitNotice("The host only checks for \"You've hit your 5-hour limit\" on a failed turn.")).toBe(false)
    expect(isUsageLimitNotice('I fixed the usage limit detection; the tests pass.')).toBe(false)
    expect(isUsageLimitNotice(`You've hit your 5-hour limit${' and more words'.repeat(40)}`)).toBe(false)
    expect(isUsageLimitNotice('rate limit exceeded (429), retrying')).toBe(false)
    expect(isUsageLimitNotice('')).toBe(false)
  })
})
