import { describe, expect, it } from 'vitest'
import { classifyAgentError, retryDelayMs } from '../src/services/agent-errors'

/** What an agent's failed turn means for its retry (burns-become-workers decision 8). */
describe('classifyAgentError', () => {
  it.each([
    ['API Error: 429 rate limit exceeded', 'claude-code'],
    ['429 Too Many Requests', 'claude-code'],
    ['rate_limit_exceeded: slow down', 'codex'],
    ['API Error: 529 {"type":"overloaded_error"}', 'claude-code'],
    ['request failed: socket hang up', 'claude-code'],
    ['read ECONNRESET', 'codex'],
    ['stream disconnected before completion', 'codex'],
    ['AgentIdleTimeout: no output for 600s', 'claude-code'],
    ['stalled: no progress for 10 minutes', 'claude-code'],
  ] as const)('%s → transient', (text, runtime) => {
    expect(classifyAgentError(text, runtime)).toBe('transient')
  })

  it.each([
    ['API Error: 400 Prompt is too long', 'claude-code'],
    ['context_length_exceeded: maximum context length is 400000 tokens', 'codex'],
    ['There is an issue with the selected model', 'claude-code'],
    ['sh: claude: command not found', 'claude-code'],
    ['something nobody has seen before', 'claude-code'],
  ] as const)('%s → fatal', (text, runtime) => {
    expect(classifyAgentError(text, runtime)).toBe('fatal')
  })

  it.each([
    ['Invalid API key · Please run /login', 'claude-code'],
    ['Your credit balance is too low to access the Anthropic API', 'claude-code'],
    ['OAuth token has expired', 'claude-code'],
    ['429 insufficient_quota: You exceeded your current quota', 'codex'],
    ['Error: Not logged in. Run codex login', 'codex'],
    ['refresh token was already used', 'codex'],
    ['API Error: 400 Claude Code 2.1.270 does not support this model; version 2.1.280 or newer is required.', 'claude-code'],
  ] as const)('%s → account', (text, runtime) => {
    expect(classifyAgentError(text, runtime)).toBe('account')
  })

  it('leaves a usage limit out of the account set: the host handles it by the carry-on setting', () => {
    expect(classifyAgentError("You've hit your 5-hour usage limit · resets 3pm", 'claude-code')).not.toBe('account')
  })

  it('reads a git permission error as no account fact', () => {
    expect(classifyAgentError('git author permission denied', 'claude-code')).not.toBe('account')
  })
})

describe('retryDelayMs', () => {
  it('backs off 5s, 10s, 20s, capped at 30s', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 30_000])
  })
})
