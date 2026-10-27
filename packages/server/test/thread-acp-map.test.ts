import type { AcpSessionUpdate, SubagentSpawnedUpdate, SubagentStateUpdate } from '@agentclientprotocol/claude-agent-acp/dist/acp-subagents.js'
import type { SDKBackgroundTasksChangedMessage } from '@anthropic-ai/claude-agent-sdk'
import { foldThread, type ThreadEvent } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import {
  backgroundTasks,
  createUpdateMapper,
  diffLines,
  elicitationAnswer,
  elicitationQuestions,
  fileChanges,
  modelEvent,
  rfdSubagentMessage,
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

describe('subagents', () => {
  it("maps claude-agent-acp's RFD-form subagent and nests its session's calls under it", () => {
    const map = mapper()
    expect(
      map({
        sessionUpdate: 'subagent_update',
        sessionId: 'child-1',
        title: 'Explore',
        description: 'Find the auth code',
        capabilities: { cancel: {} },
        state: { state: 'running' },
      }),
    ).toEqual([{ type: 'subagent', id: 'child-1', title: 'Find the auth code', status: 'in_progress' }])
    expect(map({ sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'grep auth', kind: 'search', status: 'in_progress' }, 'child-1')).toEqual([
      { type: 'tool', call: { id: 'g1', kind: 'search', title: 'grep auth', status: 'in_progress' }, parentId: 'child-1' },
    ])
    expect(map({ sessionUpdate: 'tool_call_update', toolCallId: 'g1', status: 'completed' }, 'child-1')).toEqual([
      { type: 'tool', call: { id: 'g1', status: 'completed' }, parentId: 'child-1' },
    ])
    // The subagent's own words and model stay out of the thread.
    expect(map({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Found it' } }, 'child-1')).toEqual([])
    expect(map({ sessionUpdate: 'subagent_update', sessionId: 'child-1', state: { state: 'idle', stopReason: 'end_turn' } })).toEqual([
      { type: 'subagent', id: 'child-1', status: 'completed' },
    ])
    expect(map({ sessionUpdate: 'subagent_update', sessionId: 'child-2', state: { state: 'idle', stopReason: 'cancelled' } })).toEqual([
      { type: 'subagent', id: 'child-2', status: 'failed' },
    ])
  })

  it("rewrites codex-acp's draft-form subagent messages into the RFD's, and leaves the rest alone", () => {
    const update = (u: AcpSessionUpdate) => ({ jsonrpc: '2.0' as const, method: 'session/update', params: { sessionId: 'root', update: u } })
    const spawned: SubagentSpawnedUpdate = { sessionUpdate: 'subagent_spawned', subagentSessionId: 'thr-9', name: 'explorer', task: 'Map every route in the router and…', capabilities: {} }
    expect(rfdSubagentMessage(update(spawned))).toEqual(
      update({ sessionUpdate: 'subagent_update', sessionId: 'thr-9', title: 'explorer', state: { state: 'running' } }),
    )
    const ends: [SubagentStateUpdate['state'], unknown][] = [
      ['completed', { state: 'idle', stopReason: 'end_turn' }],
      ['cancelled', { state: 'idle', stopReason: 'cancelled' }],
      ['failed', { state: 'idle', stopReason: 'error' }],
      ['disconnected', { state: 'unknown' }],
    ]
    for (const [state, rfd] of ends) {
      expect(rfdSubagentMessage(update({ sessionUpdate: 'subagent_state_update', subagentSessionId: 'thr-9', state }))).toEqual(
        update({ sessionUpdate: 'subagent_update', sessionId: 'thr-9', state: rfd as never }),
      )
    }
    const chunk = update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } })
    expect(rfdSubagentMessage(chunk)).toBe(chunk)
    const response = { jsonrpc: '2.0' as const, id: 1, result: {} }
    expect(rfdSubagentMessage(response)).toBe(response)
  })

  it('maps a rewritten Codex subagent, its calls and its end', () => {
    const map = mapper()
    expect(map({ sessionUpdate: 'subagent_update', sessionId: 'thr-9', title: 'explorer', state: { state: 'running' } })).toEqual([
      { type: 'subagent', id: 'thr-9', title: 'explorer', status: 'in_progress' },
    ])
    expect(map({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'rg router', kind: 'execute', status: 'in_progress' }, 'thr-9')).toEqual([
      { type: 'tool', call: { id: 'x1', kind: 'execute', title: 'rg router', status: 'in_progress' }, parentId: 'thr-9' },
    ])
    expect(map({ sessionUpdate: 'subagent_update', sessionId: 'thr-9', state: { state: 'idle', stopReason: 'error' } })).toEqual([
      { type: 'subagent', id: 'thr-9', status: 'failed' },
    ])
  })

  it("nests a subagent's subagent under the one the turn delegated to, and drops sessions nobody announced", () => {
    const map = mapper()
    map({ sessionUpdate: 'subagent_update', sessionId: 'child-1', title: 'Plan' })
    expect(map({ sessionUpdate: 'subagent_update', sessionId: 'grandchild', title: 'Explore' }, 'child-1')).toEqual([])
    expect(map({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Read a.ts', kind: 'read', status: 'completed' }, 'grandchild')).toEqual([
      { type: 'tool', call: { id: 'r1', kind: 'read', title: 'Read a.ts', status: 'completed' }, parentId: 'child-1' },
    ])
    expect(map({ sessionUpdate: 'tool_call', toolCallId: 'r2', title: 'Read b.ts', kind: 'read', status: 'completed' }, 'stranger')).toEqual([])
  })

  it('folds into one subagent segment holding its calls', () => {
    const map = mapper()
    const bodies = [
      { type: 'turn_started' as const },
      ...map({ sessionUpdate: 'subagent_update', sessionId: 'child-1', description: 'Find the auth code', state: { state: 'running' } }),
      ...map({ sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'grep auth', kind: 'search', status: 'completed' }, 'child-1'),
      ...map({ sessionUpdate: 'subagent_update', sessionId: 'child-1', state: { state: 'idle', stopReason: 'end_turn' } }),
      ...map({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It is in auth.ts.' } }),
    ]
    const view = foldThread(bodies.map((b, i) => ({ ...b, i, at: 1000 * i }) as ThreadEvent))
    expect(view.items[0]).toMatchObject({
      kind: 'work',
      steps: [
        { kind: 'subagent', id: 'child-1', title: 'Find the auth code', status: 'completed', calls: [{ id: 'g1', title: 'grep auth', status: 'completed' }] },
      ],
    })
    expect(view.items[1]).toMatchObject({ kind: 'agent', text: 'It is in auth.ts.' })
  })
})

describe('background commands', () => {
  const changed = (tasks: (SDKBackgroundTasksChangedMessage['tasks'][number] & { subagent_type?: string })[]): SDKBackgroundTasksChangedMessage => ({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks,
    uuid: '00000000-0000-0000-0000-000000000000',
    session_id: 'cc-1',
  })

  it("lists Claude's live background commands, not its subagents, monitors or housekeeping", () => {
    expect(
      backgroundTasks(
        changed([
          { task_id: 'b1', task_type: 'local_bash', description: 'bun run dev' },
          { task_id: 'a1', task_type: 'local_agent', subagent_type: 'Explore', description: 'Find the auth code' },
          { task_id: 'm1', task_type: 'local_monitor', description: 'watch the log' },
          { task_id: 'h1', task_type: 'local_bash', description: 'index', ambient: true },
        ]),
        [],
        500,
      ),
    ).toEqual([{ id: 'b1', title: 'bun run dev', startedAt: 500 }])
  })

  it('keeps when a listed command started, drops one that finished, and says nothing when nothing changed', () => {
    const listed = [{ id: 'b1', title: 'bun run dev', startedAt: 500 }]
    expect(backgroundTasks(changed([{ task_id: 'b1', task_type: 'local_bash', description: 'bun run dev' }]), listed, 900)).toBeNull()
    expect(
      backgroundTasks(
        changed([
          { task_id: 'b1', task_type: 'local_bash', description: 'bun run dev' },
          { task_id: 'b2', task_type: 'local_bash', description: 'bun test --watch' },
        ]),
        listed,
        900,
      ),
    ).toEqual([listed[0], { id: 'b2', title: 'bun test --watch', startedAt: 900 }])
    expect(backgroundTasks(changed([]), listed, 900)).toEqual([])
    expect(backgroundTasks({ type: 'system', subtype: 'task_started', task_id: 'b3' }, listed, 900)).toBeNull()
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
