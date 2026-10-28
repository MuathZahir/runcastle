import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCodexRateLimits } from '../src/threads/side-channels'
import { claudeUsageReport, codexUsageReport, formatResets } from '../src/threads/usage'

/** Local-time epoch seconds / ISO, so the expected clock text does not depend on the machine's zone. */
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min)

describe('formatResets', () => {
  it('says a same-day reset as a clock and a later one with its weekday', () => {
    const now = local(2026, 9, 27, 8)
    expect(formatResets(local(2026, 9, 27, 15, 40), now)).toBe('3:40 pm')
    expect(formatResets(local(2026, 9, 29, 9), now)).toBe('Thu 9:00 am')
    expect(formatResets(local(2026, 9, 29, 0, 5), now)).toBe('Thu 12:05 am')
  })
})

describe('codexUsageReport', () => {
  const weekReset = local(2099, 0, 1, 9) // a Thursday, far from "today"

  it('maps the primary and secondary windows and the auth label', () => {
    const report = codexUsageReport({
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 42.4, windowDurationMins: 300, resetsAt: weekReset.getTime() / 1000 },
        secondary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: weekReset.getTime() / 1000 },
        planType: 'pro',
      },
      authStatus: { kind: 'account', label: 'ChatGPT Pro', account: { plan: 'pro' } },
    })
    expect(report).toEqual({
      limits: [
        { label: 'Current 5-hour window', percent: 42, resets: 'Thu 9:00 am' },
        { label: 'This week', percent: 7, resets: 'Thu 9:00 am' },
      ],
      plan: 'ChatGPT Pro',
    })
  })

  it('names a plan from the snapshot when no auth status was pushed, and prefixes named limits', () => {
    const report = codexUsageReport({
      rateLimitsByLimitId: {
        codex: { limitId: 'codex', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null }, planType: 'plus' },
        codex_other: { limitId: 'codex_other', limitName: 'GPT-5-Codex-Spark', primary: { usedPercent: 150, windowDurationMins: 60, resetsAt: null } },
      },
    })
    expect(report).toEqual({
      limits: [
        { label: 'Current 5-hour window', percent: 10, resets: '' },
        { label: 'GPT-5-Codex-Spark · Current 1-hour window', percent: 100, resets: '' },
      ],
      plan: 'ChatGPT Plus',
    })
  })

  it("labels a window by its real length: a free plan's 30-day window is not a week", () => {
    const report = codexUsageReport({
      rateLimits: { limitId: 'codex', primary: { usedPercent: 13, windowDurationMins: 43200, resetsAt: null }, secondary: null, planType: 'free' },
      rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 13, windowDurationMins: 43200, resetsAt: null }, secondary: null, planType: 'free' } },
    })
    expect(report).toEqual({ limits: [{ label: 'Current 30-day window', percent: 13, resets: '' }], plan: 'ChatGPT Free' })
    expect(codexUsageReport({ rateLimits: { primary: { usedPercent: 1, windowDurationMins: 2 * 24 * 60 } } }).limits[0]?.label).toBe('Current 2-day window')
  })

  it('reports no plan for a logged-out account and no limits for unknown input', () => {
    expect(codexUsageReport({ authStatus: { kind: 'none', label: 'Not logged in' } })).toEqual({ limits: [] })
    for (const bad of [undefined, null, 'x', 4, [], {}, { rateLimits: 'x' }, { rateLimits: { primary: { usedPercent: 'a' } } }]) {
      expect(codexUsageReport(bad)).toEqual({ limits: [] })
    }
  })
})

describe("a Codex thread's usage limits", () => {
  it('are read from the app server after its initialize handshake, past its own notifications, with the plan', async () => {
    const appServer = { file: process.execPath, args: [join(import.meta.dirname, 'support', 'fake-codex-app-server.mjs')] }
    const report = codexUsageReport(await readCodexRateLimits(appServer))
    expect(report).toEqual({
      limits: [
        { label: 'Current 5-hour window', percent: 42, resets: expect.any(String) },
        { label: 'This week', percent: 7, resets: expect.any(String) },
      ],
      plan: 'ChatGPT Pro',
    })
  })
})

describe('claudeUsageReport', () => {
  const reset = local(2099, 0, 1, 9)

  it('maps the 5-hour, weekly and per-model windows with the pushed plan', () => {
    const report = claudeUsageReport({
      usage: {
        session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, model_usage: {} },
        subscription_type: 'max',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 31, resets_at: reset.toISOString() },
          seven_day: { utilization: 12.6, resets_at: reset.toISOString() },
          seven_day_opus: null,
          seven_day_sonnet: { utilization: 5, resets_at: null },
        },
        behaviors: null,
      },
      authStatus: { kind: 'account', label: 'Claude Max' },
    })
    expect(report).toEqual({
      limits: [
        { label: 'Current 5-hour window', percent: 31, resets: 'Thu 9:00 am' },
        { label: 'This week', percent: 13, resets: 'Thu 9:00 am' },
        { label: 'This week · Sonnet', percent: 5, resets: '' },
      ],
      plan: 'Claude Max',
    })
  })

  it('accepts a bare usage response, prefers model_scoped, and falls back to the subscription type', () => {
    const report = claudeUsageReport({
      subscription_type: 'pro',
      rate_limits: {
        five_hour: { utilization: null, resets_at: null },
        seven_day_opus: { utilization: 99, resets_at: null },
        model_scoped: [{ display_name: 'Opus', utilization: 20, resets_at: null }],
      },
    })
    expect(report).toEqual({
      limits: [{ label: 'This week · Opus', percent: 20, resets: '' }],
      plan: 'Claude Pro',
    })
  })

  it('returns no limits for unknown or malformed input', () => {
    for (const bad of [undefined, null, 'x', 4, [], {}, { rate_limits: null }, { usage: { rate_limits: 'x' } }]) {
      expect(claudeUsageReport(bad)).toEqual({ limits: [] })
    }
  })
})
