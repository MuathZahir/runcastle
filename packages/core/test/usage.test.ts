import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addUsage, sumSessionUsage } from '../src/usage'

const fixture = (...parts: string[]): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', 'usage', ...parts), 'utf8')

const at = (iso: string): number => Date.parse(iso)

describe('sumSessionUsage — Claude Code', () => {
  it('sums every assistant message, counting a message id streamed over several lines once', () => {
    expect(sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code')).toEqual({
      input: 13,
      cacheCreation: 1200,
      cacheRead: 2200,
      output: 89,
      total: 3502,
    })
  })

  it('lets the caller add a subagent transcript into the session total', () => {
    const main = sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code')
    const sub = sumSessionUsage(fixture('cc-session', 'subagents', 'agent-explore.jsonl'), 'claude-code')
    expect(sub).toEqual({ input: 5, cacheCreation: 400, cacheRead: 0, output: 20, total: 425 })
    expect(addUsage(main, sub).total).toBe(3927)
  })

  it('counts only the messages stamped inside the window', () => {
    const window = { from: at('2026-10-17T10:00:00Z'), to: at('2026-10-17T10:06:00Z') }
    expect(sumSessionUsage(fixture('cc-session.jsonl'), 'claude-code', window)).toEqual({
      input: 12,
      cacheCreation: 1200,
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
      cacheRead: 350,
      output: 50,
      total: 850,
    })
  })
})
