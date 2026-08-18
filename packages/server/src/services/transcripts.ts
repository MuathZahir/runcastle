import { readFileSync } from 'node:fs'

/**
 * Reading a Claude Code transcript back out (SPEC §5 — the on-disk half of a
 * session). Every session hands us a `transcript_path` through the SessionStart
 * hook, and that JSONL file is the only durable record of what was actually
 * said: the PTY dies with the server, the session row remembers ids and status,
 * the transcript remembers the conversation.
 *
 * Deliberately forgiving. The file belongs to Claude Code, not to us — it is
 * appended to while we read it, it can be deleted by `/clear` or by the human,
 * and its line shapes change between versions. Every failure here is answered
 * with "fewer turns", never with a throw: a conversation list that 500s because
 * one transcript was tidied away is worse than one that shows an untitled row.
 */

/** One side of one exchange, with the tool traffic stripped out. */
export interface TranscriptTurn {
  role: 'user' | 'assistant'
  text: string
}

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
 * The conversation in a transcript's JSONL text, oldest turn first.
 *
 * Lines that are not conversation are skipped: unparseable ones (a torn final
 * line — we may be reading a file being appended to), `summary`/`system`
 * bookkeeping entries, Claude Code's own `isMeta` injections, and anything
 * whose text is empty once the tool blocks are gone.
 */
export function parseTranscript(jsonl: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      entry = JSON.parse(trimmed) as typeof entry
    } catch {
      continue
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.isMeta) continue
    const text = contentText(entry.message?.content)
    if (!text) continue
    turns.push({ role: entry.type, text })
  }
  return turns
}

/** {@link parseTranscript} over a path; `[]` for an absent path or a file that is gone. */
export function readTranscript(path: string | null | undefined): TranscriptTurn[] {
  if (!path) return []
  try {
    return parseTranscript(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}
