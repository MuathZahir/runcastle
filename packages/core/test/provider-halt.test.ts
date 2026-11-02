import { describe, expect, it } from 'vitest'
import { classifyProviderHalt, isProviderHaltReason, providerHaltReason } from '../src/provider-halt'

// Local wall-clock dates, so the expected times read the same in every timezone.
const NOW = new Date(2026, 10, 2, 9, 0)
const epoch = (d: Date) => Math.floor(d.getTime() / 1000)

describe('classifyProviderHalt', () => {
  it('reads a Claude usage limit, with the reset time from its epoch suffix when there is one', () => {
    expect(classifyProviderHalt('run halted: 5-hour usage limit reached', NOW)).toEqual({ kind: 'usage' })
    const today = epoch(new Date(2026, 10, 2, 17, 0))
    expect(classifyProviderHalt(`run halted: Claude AI usage limit reached|${today}`, NOW)).toEqual({
      kind: 'usage',
      resets: '5pm',
    })
    const tomorrow = epoch(new Date(2026, 10, 3, 8, 30))
    expect(classifyProviderHalt(`run halted: Claude AI usage limit reached|${tomorrow}`, NOW)).toEqual({
      kind: 'usage',
      resets: 'Tue 8:30am',
    })
  })

  it('reads a "resets <time>" phrase', () => {
    expect(classifyProviderHalt('run halted: 5-hour limit reached ∙ resets 5pm', NOW)).toEqual({
      kind: 'usage',
      resets: '5pm',
    })
  })

  it('reads a Codex insufficient_quota as a usage limit', () => {
    expect(classifyProviderHalt('run halted: error: 429 insufficient_quota', NOW)).toEqual({ kind: 'usage' })
  })

  it('reads a credit balance as billing and an invalid API key as sign-in', () => {
    expect(classifyProviderHalt('run halted: Credit balance is too low', NOW)).toEqual({ kind: 'billing' })
    expect(classifyProviderHalt('run halted: Invalid API key · Please run /login', NOW)).toEqual({ kind: 'auth' })
    expect(classifyProviderHalt('run halted: error: 401 invalid_api_key', NOW)).toEqual({ kind: 'auth' })
  })

  it('leaves an unrelated error alone', () => {
    expect(classifyProviderHalt('run halted: no agent binary in the image', NOW)).toBeNull()
  })
})

describe('the provider halt reasons', () => {
  it('are the words the status line offers Resume on, and nothing else is', () => {
    const reasons = [
      providerHaltReason({ kind: 'usage', resets: '5pm' }),
      providerHaltReason({ kind: 'usage' }),
      providerHaltReason({ kind: 'billing' }),
      providerHaltReason({ kind: 'auth' }),
    ]
    expect(reasons).toEqual([
      'provider usage limit · resets 5pm',
      'provider usage limit',
      'provider billing problem — check your account',
      'provider sign-in failed — check your login or API key',
    ])
    for (const r of reasons) expect(isProviderHaltReason(r)).toBe(true)
    for (const r of ['stopped', 'provider limit', 'run halted: no agent binary', null]) {
      expect(isProviderHaltReason(r)).toBe(false)
    }
  })
})
