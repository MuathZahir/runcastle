import { describe, expect, it } from 'vitest'
import { parseTranscript } from '../src/services/transcripts'

/**
 * The transcript service's parsing seam (decision 10). Two runtimes write two
 * different JSONL formats to the path their SessionStart hook reported, and both
 * have to land in the one conversation shape the pane renders — or say plainly
 * that they could not, which is the whole point of the `unavailable` status.
 */

const lines = (...entries: unknown[]): string => entries.map((e) => JSON.stringify(e)).join('\n')

/** A Claude Code transcript entry, as `~/.claude/projects/**.jsonl` records one. */
const claudeEntry = (role: 'user' | 'assistant', content: unknown, extra: object = {}) => ({
  type: role,
  ...extra,
  message: { role, content },
})

/** A Codex rollout line: every one is `{ timestamp, type, payload }`. */
const rollout = (type: string, payload: unknown) => ({ timestamp: '2026-01-01T00:00:00.000Z', type, payload })

/** A rollout `response_item` message, the shape a said turn arrives in. */
const codexMessage = (role: 'user' | 'assistant', text: string) =>
  rollout('response_item', {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  })

describe('parsing a Claude Code transcript', () => {
  it('reads the said turns and drops the tool traffic', () => {
    expect(
      parseTranscript(
        lines(
          claudeEntry('user', 'add a settings page'),
          claudeEntry('assistant', [
            { type: 'text', text: 'Looking at what exists.' },
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file: 'x.ts' } },
          ]),
          claudeEntry('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'contents' }]),
          claudeEntry('user', 'ignore me', { isMeta: true }),
          { type: 'summary', summary: 'a compaction summary' },
        ),
        'claude-code',
      ),
    ).toEqual({
      status: 'ok',
      turns: [
        { role: 'user', text: 'add a settings page' },
        { role: 'assistant', text: 'Looking at what exists.' },
      ],
    })
  })

  /** We read a file that is still being appended to; a torn last line is normal. */
  it('skips a torn line without losing the turns around it', () => {
    expect(
      parseTranscript(
        `${lines(claudeEntry('user', 'hello'))}\n{"type":"assist`,
        'claude-code',
      ),
    ).toEqual({ status: 'ok', turns: [{ role: 'user', text: 'hello' }] })
  })
})

describe('parsing a Codex rollout', () => {
  it('reads the said turns out of the response items', () => {
    expect(
      parseTranscript(
        lines(
          rollout('session_meta', { id: 'abc', cwd: '/wt', cli_version: '0.5.0' }),
          rollout('turn_context', { cwd: '/wt', model: 'gpt-5.6-sol' }),
          codexMessage('user', 'add a settings page'),
          rollout('response_item', { type: 'reasoning', summary: [{ text: 'thinking' }] }),
          rollout('response_item', {
            type: 'function_call',
            name: 'shell',
            arguments: '{"command":"ls"}',
            call_id: 'c1',
          }),
          rollout('response_item', { type: 'function_call_output', call_id: 'c1', output: 'x.ts' }),
          codexMessage('assistant', 'I would split that in two.'),
        ),
        'codex',
      ),
    ).toEqual({
      status: 'ok',
      turns: [
        { role: 'user', text: 'add a settings page' },
        { role: 'assistant', text: 'I would split that in two.' },
      ],
    })
  })

  /**
   * Codex opens every rollout by replaying the instructions and the environment
   * as `user` messages. Nobody typed them — they are this runtime's spelling of
   * Claude Code's `isMeta`, and a pane that opened with them would be unusable.
   */
  it('drops the injected instructions and environment preamble', () => {
    expect(
      parseTranscript(
        lines(
          codexMessage('user', '<user_instructions>\nAGENTS.md said things\n</user_instructions>'),
          codexMessage('user', '<environment_context>\n  <cwd>/wt</cwd>\n</environment_context>'),
          codexMessage('user', 'offline mode for the mobile app'),
        ),
        'codex',
      ),
    ).toEqual({ status: 'ok', turns: [{ role: 'user', text: 'offline mode for the mobile app' }] })
  })

  /** A rollout that recorded nothing said is empty, not broken. */
  it('is an empty ok for a rollout with no messages in it yet', () => {
    expect(parseTranscript(lines(rollout('session_meta', { id: 'abc' })), 'codex')).toEqual({
      status: 'ok',
      turns: [],
    })
  })
})

describe('a transcript in no format we know', () => {
  it('is unavailable rather than silently empty', () => {
    for (const runtime of ['claude-code', 'codex'] as const) {
      expect(parseTranscript('not json at all\n{"hello":"world"}\n', runtime)).toEqual({
        status: 'unavailable',
        turns: [],
      })
    }
  })

  /** The other runtime's format is exactly the "format we do not know" case. */
  it('is unavailable when a session is parsed as the wrong runtime', () => {
    expect(parseTranscript(lines(codexMessage('user', 'hello')), 'claude-code')).toEqual({
      status: 'unavailable',
      turns: [],
    })
  })

  /** Nothing at all is the "cleared or never written" case, not a broken format. */
  it('is an empty ok for an empty file', () => {
    expect(parseTranscript('   \n', 'codex')).toEqual({ status: 'ok', turns: [] })
  })
})
