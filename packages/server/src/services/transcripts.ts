import { readFileSync } from 'node:fs'
import { type AgentRuntime, DEFAULT_RUNTIME } from '@runcastle/core'

/**
 * Reading a session's transcript back out (SPEC §5 — the on-disk half of a
 * session). Every session hands us a `transcript_path` through the SessionStart
 * hook, and that JSONL file is the only durable record of what was actually
 * said: the PTY dies with the server, the session row remembers ids and status,
 * the transcript remembers the conversation.
 *
 * Both runtimes report a path and neither writes the same file. Claude Code
 * appends `{ type, message }` entries; Codex appends rollout lines wrapping
 * Responses-API items. So parsing dispatches on the session's runtime, and the
 * two parsers meet in one conversation shape the pane already renders.
 *
 * Deliberately forgiving. The file belongs to the CLI, not to us — it is
 * appended to while we read it, it can be deleted by `/clear` or by the human,
 * and its line shapes change between versions. Every failure here is answered
 * with fewer turns or an `unavailable` status, never with a throw: a
 * conversation list that 500s because one transcript was tidied away is worse
 * than one that shows an untitled row.
 */

/** One side of one exchange, with the tool traffic stripped out. */
export interface TranscriptTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * A transcript, read.
 *
 * `unavailable` is the honest answer for a file we could make no sense of —
 * Codex's rollout format is internal to Codex and may shift under us (decision
 * 10), and a shifted format must read as "we cannot show this one", never as an
 * empty conversation that implies nothing was said. An absent or empty file is
 * NOT unavailable: that one really is a conversation with no record.
 */
export interface SessionTranscript {
  status: 'ok' | 'unavailable'
  /** Empty when unavailable, and when the conversation genuinely said nothing. */
  turns: TranscriptTurn[]
}

/**
 * What one parser made of a file: the turns it found, and whether it recognised
 * a single line as its own format at all. The second half is what separates a
 * conversation nobody spoke in from a file in a format we do not know.
 */
interface ParseResult {
  turns: TranscriptTurn[]
  recognized: boolean
}

/** The JSON objects of a JSONL text, skipping blanks and torn lines. */
function* entries(jsonl: string): Generator<Record<string, unknown>> {
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') yield parsed as Record<string, unknown>
    } catch {
      // A torn final line — we may be reading a file being appended to.
    }
  }
}

// --- Claude Code ------------------------------------------------------------

/** The entry types Claude Code writes; anything else is not this format. */
const CLAUDE_ENTRY_TYPES = new Set(['user', 'assistant', 'summary', 'system'])

/**
 * Text content blocks, flattened. `message.content` is either a bare string or
 * an array of blocks; `tool_use` and `tool_result` blocks are the machinery of
 * a turn rather than any part of it that was said, so they are dropped — a
 * `tool_result` block is what makes an entry `type: 'user'` without a human
 * having typed anything.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : '',
    )
    .join('')
    .trim()
}

/**
 * Claude Code's transcript JSONL. Lines that are not conversation are skipped:
 * `summary`/`system` bookkeeping entries, Claude Code's own `isMeta`
 * injections, and anything whose text is empty once the tool blocks are gone.
 */
function parseClaudeTranscript(jsonl: string): ParseResult {
  const turns: TranscriptTurn[] = []
  let recognized = false
  for (const entry of entries(jsonl)) {
    const type = entry.type
    if (typeof type !== 'string' || !CLAUDE_ENTRY_TYPES.has(type)) continue
    recognized = true
    if (type !== 'user' && type !== 'assistant') continue
    if (entry.isMeta) continue
    const text = contentText((entry.message as { content?: unknown } | undefined)?.content)
    if (!text) continue
    turns.push({ role: type, text })
  }
  return { turns, recognized }
}

// --- Codex ------------------------------------------------------------------

/**
 * The rollout line types Codex writes to `$CODEX_HOME/sessions/**.jsonl`;
 * anything else is not this format. Conversation lives in `response_item`
 * (the model-facing items); the rest is the session's own bookkeeping.
 */
const CODEX_LINE_TYPES = new Set([
  'session_meta',
  'response_item',
  'turn_context',
  'event_msg',
  'compacted',
])

/**
 * The tags Codex opens a rollout with — its instructions (the `AGENTS.md` the
 * adapter wrote) and the environment brief, replayed as `user` messages. Nobody
 * typed them: this is the runtime's spelling of Claude Code's `isMeta`, and a
 * pane that opened with an environment dump would be unreadable.
 */
const CODEX_INJECTED = ['<user_instructions>', '<environment_context>']

/**
 * A Responses-API message's content, flattened. Blocks are `input_text` on the
 * way in and `output_text` on the way out; reasoning summaries, function calls
 * and their outputs are separate item types and never reach here.
 */
function codexMessageText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) =>
      block && typeof block === 'object' ? String((block as { text?: unknown }).text ?? '') : '',
    )
    .join('')
    .trim()
}

/**
 * Codex's session rollout JSONL, best-effort by decision 10. Every line is
 * `{ timestamp, type, payload }`; the said turns are the `response_item`
 * payloads of `type: 'message'`, and every other item type — reasoning
 * summaries, `function_call`, `function_call_output` — is the machinery of a
 * turn rather than part of it, exactly as Claude Code's tool blocks are.
 *
 * `event_msg` lines carry the same prose a second time as UI events, so they
 * are recognised (this IS the format) and skipped (the items already said it).
 */
function parseCodexTranscript(jsonl: string): ParseResult {
  const turns: TranscriptTurn[] = []
  let recognized = false
  for (const line of entries(jsonl)) {
    const type = line.type
    if (typeof type !== 'string' || !CODEX_LINE_TYPES.has(type)) continue
    recognized = true
    if (type !== 'response_item') continue
    const item = line.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined
    if (!item || item.type !== 'message') continue
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const text = codexMessageText(item.content)
    if (!text) continue
    if (item.role === 'user' && CODEX_INJECTED.some((tag) => text.startsWith(tag))) continue
    turns.push({ role: item.role, text })
  }
  return { turns, recognized }
}

// --- the seam ---------------------------------------------------------------

const PARSERS: Record<AgentRuntime, (jsonl: string) => ParseResult> = {
  'claude-code': parseClaudeTranscript,
  codex: parseCodexTranscript,
}

/**
 * The conversation in a transcript's JSONL text, oldest turn first, read as the
 * given runtime writes them.
 *
 * A file with content but not one line this runtime's parser recognised is
 * `unavailable` — a format we do not know, which is the case decision 10 leaves
 * room for. A file with nothing in it at all is an ordinary empty conversation.
 */
export function parseTranscript(
  jsonl: string,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): SessionTranscript {
  const { turns, recognized } = PARSERS[runtime](jsonl)
  if (!recognized && jsonl.trim().length > 0) return { status: 'unavailable', turns: [] }
  return { status: 'ok', turns }
}

/**
 * {@link parseTranscript} over a path. An absent path or a file that is gone is
 * an empty `ok` — the conversation left no record, which the pane already has
 * words for; it is not a transcript we failed to understand.
 */
export function readTranscript(
  path: string | null | undefined,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): SessionTranscript {
  if (!path) return { status: 'ok', turns: [] }
  try {
    return parseTranscript(readFileSync(path, 'utf8'), runtime)
  } catch {
    return { status: 'ok', turns: [] }
  }
}
