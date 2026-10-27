import type * as acp from '@agentclientprotocol/sdk/unstable'
import type { DiffLine, FileChange, Question, ThreadEventBody, ToolCall, ToolKind } from '@runcastle/core'
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

/** A `tool_call`, `tool_call_update` or a permission request's call, as a tool patch. */
export function toolPatch(call: acp.ToolCall | acp.ToolCallUpdate): ToolPatch {
  const patch: ToolPatch = { id: call.toolCallId }
  if (call.kind) patch.kind = toolKind(call.kind)
  if (call.title) patch.title = call.title
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

/** The model (and effort, fast mode) a session runs on, from its config options, as a `model` event. */
export function modelEvent(options: readonly acp.SessionConfigOption[] | null | undefined): ThreadEventBody | null {
  const config = currentConfig(options)
  return config ? { type: 'model', ...config } : null
}

/**
 * Maps one thread's `session/update`s to thread events. Stateful only in the
 * ids it hands out: a chunk with no `messageId` joins the run of chunks before
 * it, and any other update ends that run.
 */
export function createUpdateMapper(newId: (prefix: string) => string): (update: acp.SessionUpdate) => ThreadEventBody[] {
  let textRun: string | undefined
  let thoughtRun: string | undefined
  return (update) => {
    if (update.sessionUpdate !== 'agent_message_chunk') textRun = undefined
    if (update.sessionUpdate !== 'agent_thought_chunk') thoughtRun = undefined
    switch (update.sessionUpdate) {
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
        return [{ type: 'tool', call: toolPatch(update) }]
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
        // The prompts are logged as they are sent; modes, notices, subagent
        // sessions and the rest have no place in the thread yet.
        return []
    }
  }
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
