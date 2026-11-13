import { describe, expect, it } from 'vitest'
import { isUsageLimitText } from '../src/provider-halt'

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
