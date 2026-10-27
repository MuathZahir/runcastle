import { describe, expect, it } from 'vitest'
import {
  createUpdateMapper,
  diffLines,
  elicitationAnswer,
  elicitationQuestions,
  fileChanges,
  modelEvent,
  toolCallOf,
} from '../src/threads/acp-map'

/** ACP session updates → thread events (chat-as-web-components ticket 1), update by update. */

function mapper() {
  let n = 0
  return createUpdateMapper((prefix) => `${prefix}-${++n}`)
}

describe('diffLines', () => {
  it('aligns an edit line by line with a little context around it', () => {
    const old = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n')
    const next = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j'].join('\n')
    expect(diffLines(old, next)).toEqual([
      { op: ' ', text: 'b' },
      { op: ' ', text: 'c' },
      { op: ' ', text: 'd' },
      { op: '-', text: 'e' },
      { op: '+', text: 'E' },
      { op: ' ', text: 'f' },
      { op: ' ', text: 'g' },
      { op: ' ', text: 'h' },
      { op: ' ', text: 'i' },
      { op: '+', text: 'j' },
    ])
  })

  it('reads a missing old text as a new file', () => {
    expect(diffLines(null, 'one\ntwo\n')).toEqual([
      { op: '+', text: 'one' },
      { op: '+', text: 'two' },
    ])
  })
})

describe('createUpdateMapper', () => {
  it('gives chunks without a message id one id per contiguous run', () => {
    const map = mapper()
    const a = map({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } })
    const b = map({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' there' } })
    map({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read a.ts', kind: 'read', status: 'in_progress' })
    const c = map({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } })
    expect(a).toEqual([{ type: 'agent_text', messageId: 'msg-1', text: 'Hi' }])
    expect(b).toEqual([{ type: 'agent_text', messageId: 'msg-1', text: ' there' }])
    expect(c).toEqual([{ type: 'agent_text', messageId: 'msg-2', text: 'Done' }])
  })

  it('keeps a message id the update carries', () => {
    expect(mapper()({ sessionUpdate: 'agent_thought_chunk', messageId: 'th', content: { type: 'text', text: 'hmm' } })).toEqual([
      { type: 'thought', thoughtId: 'th', text: 'hmm' },
    ])
  })

  it('maps tool calls with their diff and their output', () => {
    const map = mapper()
    expect(
      map({
        sessionUpdate: 'tool_call',
        toolCallId: 'e1',
        title: 'Edit a.ts',
        kind: 'edit',
        status: 'pending',
        content: [{ type: 'diff', path: '/wt/a.ts', oldText: 'x\n', newText: 'y\n' }],
      }),
    ).toEqual([
      {
        type: 'tool',
        call: {
          id: 'e1',
          kind: 'edit',
          title: 'Edit a.ts',
          status: 'pending',
          diff: { path: '/wt/a.ts', lines: [{ op: '-', text: 'x' }, { op: '+', text: 'y' }] },
        },
      },
    ])
    expect(
      map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'x1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
      }),
    ).toEqual([{ type: 'tool', call: { id: 'x1', status: 'completed', output: 'ok' } }])
    expect(map({ sessionUpdate: 'tool_call', toolCallId: 'm', title: 'Mode', kind: 'switch_mode' })).toEqual([
      { type: 'tool', call: { id: 'm', kind: 'other', title: 'Mode' } },
    ])
  })

  it('maps plan, commands, usage, title, suggestion, model and compaction', () => {
    const map = mapper()
    expect(map({ sessionUpdate: 'plan', entries: [{ content: 'Do it', priority: 'high', status: 'in_progress' }] })).toEqual([
      { type: 'plan', entries: [{ content: 'Do it', status: 'in_progress' }] },
    ])
    expect(map({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review' }] })).toEqual([
      { type: 'commands', commands: [{ name: 'review', description: 'Review' }] },
    ])
    expect(map({ sessionUpdate: 'usage_update', used: 5000, size: 200000, cost: { amount: 0.12, currency: 'USD' } })).toEqual([
      { type: 'usage', context: { used: 5000, size: 200000, costUsd: 0.12 } },
    ])
    expect(
      map({ sessionUpdate: 'session_info_update', title: 'Fix the login', _meta: { promptSuggestions: { suggestions: [{ text: 'run the tests' }] } } }),
    ).toEqual([
      { type: 'title', title: 'Fix the login' },
      { type: 'suggestion', text: 'run the tests' },
    ])
    expect(map({ sessionUpdate: 'session_info_update', _meta: { promptSuggestions: { suggestions: [] } } })).toEqual([
      { type: 'suggestion', text: null },
    ])
    expect(map({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } })).toEqual([])
  })
})

describe('modelEvent', () => {
  it('names the current model from the session config options', () => {
    expect(
      modelEvent([
        { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: [] },
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'claude-opus-5-5',
          options: [
            { value: 'claude-opus-5-5', name: 'Opus 5.5' },
            { value: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
          ],
        },
      ]),
    ).toEqual({ type: 'model', model: 'claude-opus-5-5', label: 'Opus 5.5' })
    expect(modelEvent(undefined)).toBeNull()
  })
})

describe('turn changes', () => {
  it('joins diffs per file and counts the lines', () => {
    expect(
      fileChanges([
        { path: 'a.ts', lines: [{ op: '-', text: 'x' }, { op: '+', text: 'y' }] },
        { path: 'b.ts', lines: [{ op: '+', text: 'n' }] },
        { path: 'a.ts', lines: [{ op: '+', text: 'z' }] },
      ]),
    ).toEqual([
      { path: 'a.ts', added: 2, removed: 1, lines: [{ op: '-', text: 'x' }, { op: '+', text: 'y' }, { op: '+', text: 'z' }] },
      { path: 'b.ts', added: 1, removed: 0, lines: [{ op: '+', text: 'n' }] },
    ])
  })

  it('fills an approval card call over blank defaults', () => {
    expect(toolCallOf({ toolCallId: 'p', title: 'bun add zod' })).toEqual({ id: 'p', kind: 'other', title: 'bun add zod', status: 'pending' })
  })
})

describe('AskUserQuestion over elicitation', () => {
  const request = {
    mode: 'form' as const,
    sessionId: 's',
    toolCallId: 'q1',
    message: 'Please answer the following questions.',
    requestedSchema: {
      type: 'object' as const,
      properties: {
        question_0: {
          type: 'string' as const,
          title: 'Page size',
          description: 'Which page size?',
          oneOf: [
            { const: 'A4', title: 'A4' },
            { const: 'Letter', title: 'Letter', description: 'US' },
          ],
        },
        question_0_custom: { type: 'string' as const, title: 'Other' },
        question_1: { type: 'array' as const, title: 'Sides', description: 'Which sides?', items: { anyOf: [{ const: 'Front', title: 'Front' }, { const: 'Back', title: 'Back' }] } },
        question_1_custom: { type: 'string' as const, title: 'Other' },
      },
    },
  }

  it('reads the questions out of the form', () => {
    expect(elicitationQuestions(request)).toEqual([
      { header: 'Page size', question: 'Which page size?', options: [{ label: 'A4' }, { label: 'Letter', description: 'US' }] },
      { header: 'Sides', question: 'Which sides?', options: [{ label: 'Front' }, { label: 'Back' }], multiSelect: true },
    ])
    expect(elicitationQuestions({ mode: 'url', sessionId: 's', elicitationId: 'e', url: 'https://x', message: 'Sign in' })).toBeNull()
  })

  it('answers with options picked and anything else as Other', () => {
    const questions = elicitationQuestions(request)!
    expect(elicitationAnswer(questions, { 'Which page size?': 'A5', 'Which sides?': 'Front, Back, Spine' })).toEqual({
      action: 'accept',
      content: { question_0_custom: 'A5', question_1: ['Front', 'Back'], question_1_custom: 'Spine' },
    })
    expect(elicitationAnswer(questions, { 'Which page size?': 'Letter' })).toEqual({ action: 'accept', content: { question_0: 'Letter' } })
  })
})
