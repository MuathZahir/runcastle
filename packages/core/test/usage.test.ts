import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addUsage, countedMessages, sumSessionUsage, weightedTokens } from '../src/usage'

const fixture = (...parts: string[]): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', 'usage', ...parts), 'utf8')

const at = (iso: string): number => Date.parse(iso)

describe('sumSessionUsage — Claude Code', () => {
  it('sums every assistant message, counting a message id streamed over several lines once', () => {
    expect(sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code')).toEqual({
      input: 13,
      cacheCreation: 1200,
      cacheCreation1h: 0,
      cacheRead: 2200,
      output: 89,
      total: 3502,
    })
  })

  it('lets the caller add a subagent transcript into the session total', () => {
    const main = sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code')
    const sub = sumSessionUsage(fixture('cc-session', 'subagents', 'agent-explore.jsonl'), 'claude-code')
    expect(sub).toEqual({ input: 5, cacheCreation: 400, cacheCreation1h: 0, cacheRead: 0, output: 20, total: 425 })
    expect(addUsage(main, sub).total).toBe(3927)
  })

  it('counts only the messages stamped inside the window', () => {
    const window = { from: at('2026-10-17T10:00:00Z'), to: at('2026-10-17T10:06:00Z') }
    expect(sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code', window)).toEqual({
      input: 12,
      cacheCreation: 1200,
      cacheCreation1h: 0,
      cacheRead: 1000,
      output: 80,
      total: 2292,
    })
    expect(
      sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code', { from: at('2026-10-17T10:06:00Z') }).total,
    ).toBe(1210)
  })

  it('reads an empty or foreign text as zero', () => {
    expect(sumSessionUsage('', 'claude-code').total).toBe(0)
    expect(sumSessionUsage('not json\n{"type":"other"}', 'claude-code').total).toBe(0)
  })
})

describe('sumSessionUsage — Codex', () => {
  it('sums the rollout per turn, moving cached input to cacheRead and skipping repeated events', () => {
    expect(sumSessionUsage(fixture('codex-rollout.jsonl'), 'codex')).toEqual({
      input: 1600,
      cacheCreation: 0,
      cacheCreation1h: 0,
      cacheRead: 900,
      output: 160,
      total: 2660,
    })
  })

  it('honours the window', () => {
    expect(
      sumSessionUsage(fixture('codex-rollout.jsonl'), 'codex', { from: at('2026-10-17T10:01:00Z') }).total,
    ).toBe(1560)
  })

  it('sums the turn.completed usage of a codex exec --json stream', () => {
    const stream = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.completed","usage":{"input_tokens":300,"cached_input_tokens":100,"output_tokens":40}}',
      '{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":250,"output_tokens":10}}',
    ].join('\n')
    expect(sumSessionUsage(stream, 'codex')).toEqual({
      input: 450,
      cacheCreation: 0,
      cacheCreation1h: 0,
      cacheRead: 350,
      output: 50,
      total: 850,
    })
  })
})

describe('countedMessages', () => {
  const line = (id: string, iso: string, usage: Record<string, unknown>) =>
    JSON.stringify({ type: 'assistant', timestamp: iso, message: { id, usage } })

  it('yields each message once, stamped, with the last streamed line’s figures and the 1-hour cache split', () => {
    const text = [
      line('a', '2026-11-01T10:00:00Z', { input_tokens: 1, output_tokens: 1 }),
      '{"type":"user","message":{"content":"a long tool result"}}',
      line('a', '2026-11-01T10:00:01Z', {
        input_tokens: 1,
        output_tokens: 9,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
      }),
      line('b', '2026-11-01T10:05:00Z', { cache_read_input_tokens: 50, cache_creation_input_tokens: 40 }),
    ].join('\n')
    expect(countedMessages(text, 'claude-code')).toEqual([
      {
        at: at('2026-11-01T10:00:01Z'),
        usage: { input: 1, cacheCreation: 300, cacheCreation1h: 200, cacheRead: 0, output: 9, total: 310 },
      },
      {
        at: at('2026-11-01T10:05:00Z'),
        usage: { input: 0, cacheCreation: 40, cacheCreation1h: 0, cacheRead: 50, output: 0, total: 90 },
      },
    ])
  })

  it('yields one message per Codex turn', () => {
    expect(countedMessages(fixture('codex-rollout.jsonl'), 'codex').reduce((n, m) => n + m.usage.total, 0)).toBe(2660)
  })
})

describe('weightedTokens', () => {
  it('prices every kind as uncached input', () => {
    expect(
      weightedTokens({ input: 10, cacheCreation: 300, cacheCreation1h: 200, cacheRead: 1000, output: 4 }),
    ).toBe(10 + 100 * 1.25 + 200 * 2 + 1000 * 0.1 + 4 * 5)
  })

  it('reads a breakdown stored before the 1-hour split as all 5-minute writes', () => {
    expect(weightedTokens({ input: 0, cacheCreation: 100, cacheRead: 0, output: 0 })).toBe(125)
  })
})
