import type { AcpSessionUpdate, SubagentState } from '@agentclientprotocol/claude-agent-acp/dist/acp-subagents.js'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import type { SDKBackgroundTasksChangedMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BackgroundTask, DiffLine, FileChange, Question, ThreadEventBody, ToolCall, ToolKind, ToolStatus } from '@runcastle/core'
import { currentConfig } from './controls'

/**
 * ACP → thread events, pure (chat-as-web-components; ADR-0015). The agent host
 * feeds every `session/update` through {@link createUpdateMapper} and appends
 * what comes out to the thread log; nothing here does IO, so the mapping is
 * tested on its own, update by update.
 */

/** A tool call as a `tool` event carries it: the fields this update says, keyed by id. */
export type ToolPatch = Partial<ToolCall> & { id: string }

/** One file change a tool call reported. */
export interface ToolDiff {
  path: string
  lines: DiffLine[]
}

/** Unchanged lines kept on either side of a change. */
const DIFF_CONTEXT = 3
/** Past this many cells the line diff gives up on alignment and shows old out, new in. */
const DIFF_MAX_CELLS = 4_000_000

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * A line-by-line diff of `oldText` → `newText` (a longest-common-subsequence
 * alignment), trimmed to {@link DIFF_CONTEXT} unchanged lines around each
 * change. A missing `oldText` is a new file: every line is added.
 */
export function diffLines(oldText: string | null | undefined, newText: string): DiffLine[] {
  const a = splitLines(oldText ?? '')
  const b = splitLines(newText)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle: DiffLine[] = []
  if (midA.length * midB.length > DIFF_MAX_CELLS) {
    for (const text of midA) middle.push({ op: '-', text })
    for (const text of midB) middle.push({ op: '+', text })
  } else {
    // lcs[i][j]: the common subsequence length of midA[i..] and midB[j..].
    const lcs = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1))
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        middle.push({ op: ' ', text: midA[i++] })
        j++
      } else if (i < midA.length && (j === midB.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
        // Removals before additions on a tie, as a unified diff reads.
        middle.push({ op: '-', text: midA[i++] })
      } else middle.push({ op: '+', text: midB[j++] })
    }
  }
  const all: DiffLine[] = [
    ...a.slice(0, start).map((text): DiffLine => ({ op: ' ', text })),
    ...middle,
    ...a.slice(endA).map((text): DiffLine => ({ op: ' ', text })),
  ]
  const changed = all.map((l, n) => (l.op === ' ' ? -1 : n)).filter((n) => n >= 0)
  return all.filter((l, n) => l.op !== ' ' || changed.some((c) => Math.abs(c - n) <= DIFF_CONTEXT))
}

const TOOL_KINDS: readonly ToolKind[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other']

/** ACP's tool kind as the thread's; `switch_mode` and anything newer is `other`. */
function toolKind(kind: string): ToolKind {
  return (TOOL_KINDS as readonly string[]).includes(kind) ? (kind as ToolKind) : 'other'
}

/** The file changes in a tool call's content. */
export function toolDiffs(content: readonly acp.ToolCallContent[] | null | undefined): ToolDiff[] {
  return (content ?? []).flatMap((c) => (c.type === 'diff' ? [{ path: c.path, lines: diffLines(c.oldText, c.newText) }] : []))
}

/** What a tool call printed: the text of its plain content blocks. */
function toolOutput(content: readonly acp.ToolCallContent[] | null | undefined): string | undefined {
  const texts = (content ?? []).flatMap((c) => (c.type === 'content' && c.content.type === 'text' ? [c.content.text] : []))
  return texts.length ? texts.join('\n') : undefined
}

/** codex-acp's titles for a file change, whatever files it touches. */
const CODEX_EDIT_TITLES = new Set(['Editing files', 'Edit files'])

/** A codex-acp file change named by the files it touches ("Edit src/a.ts, src/b.ts"), when it says them. */
function editTitle(call: acp.ToolCall | acp.ToolCallUpdate): string | undefined {
  const paths = new Set([...toolDiffs(call.content).map((d) => d.path), ...(call.locations ?? []).map((l) => l.path)])
  return paths.size ? `Edit ${[...paths].join(', ')}` : undefined
}

/**
 * What a call printed since its last update, where codex-acp streams it: a
 * command's output chunks in `_meta.terminal_output_delta` (`terminal_output`
 * for a client that asked for Zed's form), an MCP tool's progress in
 * `_meta.mcp_output_delta`, each `{ data }`. Never in `content`, so a Codex
 * command reads as printing nothing without this.
 */
function streamedOutput(call: acp.ToolCall | acp.ToolCallUpdate): string | undefined {
  const meta = call._meta as Record<string, { data?: unknown } | undefined> | null | undefined
  const chunks = ['terminal_output_delta', 'terminal_output', 'mcp_output_delta'].map((key) => meta?.[key]?.data)
  const text = chunks.filter((d): d is string => typeof d === 'string').join('')
  return text || undefined
}

/** A `tool_call` or `tool_call_update` as a `tool` event, with any output it streamed. */
function toolEvent(call: acp.ToolCall | acp.ToolCallUpdate, parentId?: string): ThreadEventBody {
  const outputAppend = streamedOutput(call)
  return { type: 'tool', call: toolPatch(call), ...(parentId !== undefined ? { parentId } : {}), ...(outputAppend ? { outputAppend } : {}) }
}

/** A `tool_call`, `tool_call_update` or a permission request's call, as a tool patch. */
export function toolPatch(call: acp.ToolCall | acp.ToolCallUpdate): ToolPatch {
  const patch: ToolPatch = { id: call.toolCallId }
  if (call.kind) patch.kind = toolKind(call.kind)
  if (call.title) patch.title = (CODEX_EDIT_TITLES.has(call.title) && editTitle(call)) || call.title
  if (call.status) patch.status = call.status
  const output = toolOutput(call.content)
  if (output !== undefined) patch.output = output
  const [diff] = toolDiffs(call.content)
  if (diff) patch.diff = diff
  return patch
}

/** A whole tool call, for an approval card: the patch over blank defaults. */
export function toolCallOf(call: acp.ToolCall | acp.ToolCallUpdate): ToolCall {
  return { kind: 'other', title: '', status: 'pending', ...toolPatch(call) }
}

/**
 * A turn's changes card: every diff its tool calls reported, joined per file,
 * in first-touched order, with the lines added and removed counted.
 */
export function fileChanges(diffs: readonly ToolDiff[]): FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const d of diffs) {
    const file = byPath.get(d.path) ?? { path: d.path, added: 0, removed: 0, lines: [] }
    file.lines.push(...d.lines)
    file.added += d.lines.filter((l) => l.op === '+').length
    file.removed += d.lines.filter((l) => l.op === '-').length
    byPath.set(d.path, file)
  }
  return [...byPath.values()]
}

/**
 * `text` with every path under `worktree` in it said relative to the worktree
 * ("Read /home/me/wt/src/a.ts" → "Read src/a.ts"), in either separator, with a
 * Windows drive letter in either case. A path is only cut where one starts.
 */
export function relativeToWorktree(worktree: string, text: string): string {
  const root = worktree.replace(/[\\/]+$/, '')
  if (!root) return text
  const escaped = root
    .split(/[\\/]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]')
  const sameCase = /^[A-Za-z]:/.test(root) ? 'gi' : 'g'
  return text.replace(new RegExp(`(?<![\\w.\\-\\\\/])${escaped}[\\\\/]+`, sameCase), '')
}

/** A tool call with the paths in its row worktree-relative. */
function relativeCall<T extends Partial<ToolCall>>(worktree: string, call: T): T {
  return {
    ...call,
    ...(call.title !== undefined ? { title: relativeToWorktree(worktree, call.title) } : {}),
    ...(call.diff ? { diff: { ...call.diff, path: relativeToWorktree(worktree, call.diff.path) } } : {}),
  }
}

/**
 * The event as the thread shows it: tool rows, approvals and the changes card
 * name files relative to the thread's worktree, never by absolute path. Applied
 * when the log is read, so threads logged before this read the same.
 */
export function withRelativePaths<E extends ThreadEventBody>(worktree: string, e: E): E {
  switch (e.type) {
    case 'tool':
      return { ...e, call: relativeCall(worktree, e.call) }
    case 'ask':
      return e.ask.kind === 'approval' ? { ...e, ask: { ...e.ask, call: relativeCall(worktree, e.ask.call) } } : e
    case 'turn_ended':
      return e.files ? { ...e, files: e.files.map((f) => ({ ...f, path: relativeToWorktree(worktree, f.path) })) } : e
    default:
      return e
  }
}

/** The model (and effort, fast mode) a session runs on, from its config options, as a `model` event. */
export function modelEvent(options: readonly acp.SessionConfigOption[] | null | undefined): Extract<ThreadEventBody, { type: 'model' }> | null {
  const config = currentConfig(options)
  return config ? { type: 'model', ...config } : null
}

/** A subagent's state (`subagent_update.state`), as a tool status. */
function subagentStatus(state: acp.StateUpdate | null | undefined): ToolStatus | undefined {
  if (!state) return undefined
  if (state.state === 'running' || state.state === 'requires_action') return 'in_progress'
  if (state.state !== 'idle') return undefined
  const stopReason = (state as { stopReason?: unknown }).stopReason
  return stopReason === undefined || stopReason === null || stopReason === 'end_turn' ? 'completed' : 'failed'
}

/** The draft form's end of a subagent, as the RFD's state. */
function rfdState(state: SubagentState): acp.StateUpdate {
  switch (state) {
    case 'completed':
      return { state: 'idle', stopReason: 'end_turn' }
    case 'cancelled':
      return { state: 'idle', stopReason: 'cancelled' }
    case 'failed':
      return { state: 'idle', stopReason: 'error' }
    default:
      // `disconnected`: the subagent can no longer be observed.
      return { state: 'unknown' }
  }
}

/**
 * codex-acp announces subagents in the subagents RFD's earlier draft
 * (`subagent_spawned`, `subagent_state_update`, as claude-agent-acp types
 * them), which the ACP SDK's client rejects before any handler sees it. This
 * rewrites one message from the adapter into the RFD's `subagent_update`, and
 * passes every other message through untouched. The spawn's `task` is the
 * subagent's whole prompt, so only its `name` becomes the title.
 */
export function rfdSubagentMessage<M extends object>(message: M): M {
  const m = message as { method?: unknown; params?: { sessionId?: unknown; update?: AcpSessionUpdate } }
  const update = m.method === 'session/update' ? m.params?.update : undefined
  if (update?.sessionUpdate === 'subagent_spawned') {
    const rfd: acp.SessionUpdate = { sessionUpdate: 'subagent_update', sessionId: update.subagentSessionId, title: update.name, state: { state: 'running' } }
    return { ...message, params: { ...m.params, update: rfd } }
  }
  if (update?.sessionUpdate === 'subagent_state_update') {
    const rfd: acp.SessionUpdate = { sessionUpdate: 'subagent_update', sessionId: update.subagentSessionId, state: rfdState(update.state) }
    return { ...message, params: { ...m.params, update: rfd } }
  }
  return message
}

/**
 * Maps one thread's `session/update`s to thread events. Stateful in the ids it
 * hands out — a chunk with no `messageId` joins the run of chunks before it,
 * and any other update ends that run — and in the subagents it has seen.
 *
 * Subagents (clientCapabilities.subagents): an adapter announces a subagent
 * with `subagent_update` on its parent session (codex-acp's draft form is
 * rewritten to it on the wire, {@link rfdSubagentMessage}) and then sends the
 * subagent's own work under the subagent's session id. `from` is that session
 * id, given for an update that did not come from the thread's own session. A
 * subagent's tool calls nest under it (`parentId`); a subagent of a subagent
 * nests under the one the turn delegated to; the rest of a subagent's session
 * (its words, plan, usage) has no place in the thread, and neither has a
 * session nobody announced.
 */
export function createUpdateMapper(newId: (prefix: string) => string): (update: acp.SessionUpdate, from?: string) => ThreadEventBody[] {
  let textRun: string | undefined
  let thoughtRun: string | undefined
  /** Each announced subagent session, to the subagent the thread shows its work under. */
  const subagents = new Map<string, string>()

  /** Note a subagent session, announced on the thread's own session or (`parent`) on a subagent's. */
  const announced = (child: string, parent: string | undefined): void => {
    const shownUnder = parent === undefined ? child : subagents.get(parent)
    if (shownUnder !== undefined && !subagents.has(child)) subagents.set(child, shownUnder)
  }

  const fromSubagent = (update: acp.SessionUpdate, from: string): ThreadEventBody[] => {
    const parentId = subagents.get(from)
    if (parentId === undefined) return []
    switch (update.sessionUpdate) {
      case 'tool_call':
      case 'tool_call_update':
        return [toolEvent(update, parentId)]
      case 'subagent_update':
        announced(update.sessionId, from)
        return []
      default:
        return []
    }
  }

  return (update, from) => {
    if (from !== undefined) return fromSubagent(update, from)
    if (update.sessionUpdate !== 'agent_message_chunk') textRun = undefined
    if (update.sessionUpdate !== 'agent_thought_chunk') thoughtRun = undefined
    switch (update.sessionUpdate) {
      case 'subagent_update': {
        const id = update.sessionId
        announced(id, undefined)
        // claude-agent-acp's description is the delegated task ("Find the auth code"), its title the agent's role.
        const title = update.description ?? update.title
        const status = subagentStatus(update.state)
        return [{ type: 'subagent', id, ...(title ? { title } : {}), ...(status ? { status } : {}) }]
      }
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') return []
        const messageId = update.messageId ?? (textRun ??= newId('msg'))
        return [{ type: 'agent_text', messageId, text: update.content.text }]
      }
      case 'agent_thought_chunk': {
        if (update.content.type !== 'text') return []
        const thoughtId = update.messageId ?? (thoughtRun ??= newId('thought'))
        return [{ type: 'thought', thoughtId, text: update.content.text }]
      }
      case 'tool_call':
      case 'tool_call_update':
        return [toolEvent(update)]
      case 'plan':
        return [{ type: 'plan', entries: update.entries.map((e) => ({ content: e.content, status: e.status })) }]
      case 'available_commands_update':
        return [{ type: 'commands', commands: update.availableCommands.map((c) => ({ name: c.name, description: c.description })) }]
      case 'usage_update': {
        if (!(update.size > 0)) return []
        const costUsd = update.cost?.currency === 'USD' ? update.cost.amount : undefined
        return [{ type: 'usage', context: { used: Math.max(0, update.used), size: update.size, ...(costUsd !== undefined ? { costUsd } : {}) } }]
      }
      case 'session_info_update': {
        const out: ThreadEventBody[] = []
        if (update.title) out.push({ type: 'title', title: update.title })
        const suggestions = (update._meta?.promptSuggestions as { suggestions?: { text?: unknown }[] } | undefined)?.suggestions
        if (Array.isArray(suggestions)) {
          const text = suggestions.map((s) => s.text).find((t): t is string => typeof t === 'string' && t.trim() !== '')
          out.push({ type: 'suggestion', text: text ?? null })
        }
        return out
      }
      case 'config_option_update': {
        const model = modelEvent(update.configOptions)
        return model ? [model] : []
      }
      case 'compaction_update':
        return update.status === 'completed' ? [{ type: 'compacted' }] : []
      default:
        // The prompts are logged as they are sent; modes, notices, session
        // messages and the rest have no place in the thread yet.
        return []
    }
  }
}

/**
 * How claude-agent-acp forwards the Agent SDK's own messages that a session's
 * `_meta.claudeCode.emitRawSDKMessages` names (the Claude runtime's `acpLaunch`).
 */
export const CLAUDE_SDK_MESSAGE_METHOD = '_claude/sdkMessage'

/** Background work the strip does not list: subagents (their own rows), monitors (output for the model only), housekeeping. */
function isBackgroundCommand(task: SDKBackgroundTasksChangedMessage['tasks'][number] & { subagent_type?: string }): boolean {
  return task.task_type !== 'local_agent' && task.subagent_type === undefined && task.task_type !== 'local_monitor' && task.ambient !== true
}

/**
 * The background commands a Claude session runs now, from a forwarded SDK
 * message (`background_tasks_changed`, the whole live set each time it
 * changes), or null when the message is not that or changes nothing. A task
 * already listed keeps its `startedAt`; a new one started `now`.
 */
export function backgroundTasks(message: unknown, listed: readonly BackgroundTask[], now: number): BackgroundTask[] | null {
  const m = message as Partial<SDKBackgroundTasksChangedMessage> | null
  if (m?.type !== 'system' || m.subtype !== 'background_tasks_changed' || !Array.isArray(m.tasks)) return null
  const tasks = m.tasks.filter(isBackgroundCommand).map((task): BackgroundTask => {
    const known = listed.find((t) => t.id === task.task_id)
    return { id: task.task_id, title: task.description, startedAt: known?.startedAt ?? now }
  })
  const same = tasks.length === listed.length && tasks.every((t, n) => t.id === listed[n].id && t.title === listed[n].title)
  return same ? null : tasks
}

/** A forwarded SDK message saying the Claude session went idle (`session_state_changed`): no model turn runs. */
export function wentIdle(message: unknown): boolean {
  const m = message as { type?: unknown; subtype?: unknown; state?: unknown } | null
  return m?.type === 'system' && m.subtype === 'session_state_changed' && m.state === 'idle'
}

// ---- AskUserQuestion over elicitation ----

/** claude-agent-acp's field key for question `n`, and its free-text companion. */
const questionKey = (n: number): string => `question_${n}`
const customKey = (n: number): string => `question_${n}_custom`

interface EnumOption {
  const: string
  title?: string
  description?: string
}

/**
 * The questions of an AskUserQuestion elicitation, or null for any other
 * elicitation. claude-agent-acp renders the tool as a form whose fields are
 * `question_<n>` (a titled `oneOf`, or an array of `anyOf` for multi-select)
 * each followed by its `question_<n>_custom` "Other" box; a single question's
 * text rides the form's `message`.
 */
export function elicitationQuestions(req: acp.CreateElicitationRequest): Question[] | null {
  if (req.mode !== 'form' || !('requestedSchema' in req)) return null
  const properties = (req.requestedSchema as acp.ElicitationSchema).properties ?? {}
  const questions: Question[] = []
  for (let n = 0; questionKey(n) in properties; n++) {
    const field = properties[questionKey(n)] as { title?: string; description?: string; oneOf?: EnumOption[]; items?: { anyOf?: EnumOption[] }; type?: string }
    const multiSelect = field.type === 'array'
    const options = (multiSelect ? field.items?.anyOf : field.oneOf) ?? []
    questions.push({
      header: field.title ?? '',
      question: field.description ?? req.message,
      options: options.map((o) => ({ label: o.title ?? o.const, ...(o.description ? { description: o.description } : {}) })),
      ...(multiSelect ? { multiSelect: true } : {}),
    })
  }
  return questions.length ? questions : null
}

/**
 * The elicitation response that answers `questions` with `answers` (keyed by
 * question text, as the human's `AskAnswer` carries them). An answer naming an
 * option picks it; anything else is the question's "Other" text. A
 * multi-select answer is the picked labels joined with ", ".
 */
export function elicitationAnswer(questions: readonly Question[], answers: Record<string, string>): acp.CreateElicitationResponse {
  const content: Record<string, string | string[]> = {}
  questions.forEach((q, n) => {
    const answer = answers[q.question]
    if (answer === undefined || answer === '') return
    const labels = q.options.map((o) => o.label)
    if (q.multiSelect) {
      const parts = answer.split(', ')
      const picked = parts.filter((p) => labels.includes(p))
      const other = parts.filter((p) => !labels.includes(p)).join(', ')
      if (picked.length) content[questionKey(n)] = picked
      if (other) content[customKey(n)] = other
    } else if (labels.includes(answer)) content[questionKey(n)] = answer
    else content[customKey(n)] = answer
  })
  return { action: 'accept', content }
}
