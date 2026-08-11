import type { EventRow, RunStatus } from '@runcastle/core'

/**
 * What the inspector's Activity feed renders for one event (findings F10.5,
 * F18).
 *
 * The feed is the audit log a returning user reads to answer "what happened
 * while I was away", and two kinds of event were making it unreadable. Burn
 * TOOL events carry the agent's raw invocation as their message — a line like
 * `Bash cd /home/agent/repo && git add -A && git commit -m …` — which is the
 * agent's internals leaking into a human-facing timeline. Burn TEXT events
 * carry the agent's prose verbatim, markdown and all, so `##` headings rendered
 * as literal hashes in the middle of a status feed. Both were then cut off by
 * CSS with no way to see the rest.
 *
 * So each event becomes a plain-text summary that always reads as a sentence,
 * plus the full text underneath for the rows worth opening.
 */

export interface ActivityLine {
  /** One line of plain text — no markdown, no raw payload. */
  summary: string
  /** Everything the summary left out, or null when it left nothing out. */
  detail: string | null
}

/** How much of a message the collapsed row carries before it is worth opening. */
const SUMMARY_MAX = 140
/** A tool call's argument preview is tighter — the tool name is the headline. */
const TOOL_ARGS_MAX = 64

/**
 * Markdown down to the words it was decorating. Not a parser: the feed needs
 * prose that reads correctly at one line, not a rendering, and every construct
 * below is one an agent's status prose actually contains.
 */
export function stripMarkdown(source: string): string {
  return source
    .replace(/```[^\n]*\n?/g, '') // fence lines, keeping the code between them
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ## Heading
    .replace(/^\s{0,3}>\s?/gm, '') // > quote
    .replace(/^\s*[-*+]\s+/gm, '') // - bullet
    .replace(/^\s*\d+\.\s+/gm, '') // 1. numbered
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // ![alt](src)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](href)
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **bold**
    .replace(/~~(.+?)~~/g, '$1') // ~~struck~~
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_]($|[\s.,;:)!?])/g, '$1$2$3') // *emphasis*
    .replace(/`([^`]+)`/g, '$1') // `code`
    .trim()
}

/** The first line with anything on it, trimmed. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t !== '') return t
  }
  return ''
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** The `data` a `*.tool` event carries (ticket-burner's stream mapper). */
function toolCall(data: unknown): { name: string; args: string } | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.name !== 'string' || d.name === '') return null
  return { name: d.name, args: typeof d.args === 'string' ? d.args : '' }
}

/** Whether the event is an agent tool invocation rather than a status line. */
function isToolEvent(type: string): boolean {
  return type.endsWith('.tool')
}

export function activityLine(
  event: Pick<EventRow, 'type' | 'message' | 'data'>,
): ActivityLine {
  if (isToolEvent(event.type)) {
    const call = toolCall(event.data)
    // Without the structured payload there is nothing to summarize from but the
    // message, which is exactly the raw dump — so at least keep it to one line.
    if (!call) {
      const line = firstLine(event.message)
      return {
        summary: truncate(line, SUMMARY_MAX) || event.type,
        detail: event.message.trim() === line ? null : event.message.trim(),
      }
    }
    const preview = truncate(firstLine(call.args), TOOL_ARGS_MAX)
    return {
      summary: preview ? `${call.name} — ${preview}` : `${call.name}`,
      detail: call.args.trim() === '' ? null : call.args.trim(),
    }
  }

  const plain = stripMarkdown(event.message)
  const line = firstLine(plain)
  const summary = truncate(line, SUMMARY_MAX)
  // Worth opening only when the summary genuinely dropped something.
  const detail = plain === summary ? null : plain
  return { summary: summary || event.type, detail }
}

// --- the run stream's colour ------------------------------------------------

/** What colour class an event line reads as. */
export type EventLevel = 'error' | 'ok' | 'active' | 'info'

/**
 * The terminal status a `run.finished` event carries, or `null` for any other
 * event (and for a payload that predates the field). The runner writes it into
 * `data` when it finalizes a run — the same payload the desktop notification
 * reads, and the only place the outcome is actually recorded.
 */
function runFinishedStatus(event: Pick<EventRow, 'type' | 'data'>): RunStatus | null {
  if (event.type !== 'run.finished') return null
  if (typeof event.data !== 'object' || event.data === null) return null
  const status = (event.data as Record<string, unknown>).status
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status
  return null
}

/**
 * Colour class for one event line in the run stream.
 *
 * A finished run is the one event whose type says nothing about how it went:
 * `run.finished` is the type whether the burn succeeded, failed or was
 * cancelled, so the keyword scan below painted every ended burn green — a
 * failed burn rendered as success while the desktop notification, reading the
 * same event's payload, said "Burn failed". The structured status wins wherever
 * it exists; the keyword scan is the fallback for the events that carry none.
 */
export function eventLevel(event: Pick<EventRow, 'type' | 'data'>): EventLevel {
  const status = runFinishedStatus(event)
  if (status) return status === 'succeeded' ? 'ok' : 'error'

  const type = event.type
  // In-loop conflict resolution is progress, not failure — checked before the
  // generic `conflict` keyword, which would otherwise paint the whole resolve red.
  if (type === 'merge.conflict.resolved') return 'ok'
  if (type === 'merge.conflict.resolving') return 'active'
  if (/(error|fail|conflict|cancel|stopped)/i.test(type)) return 'error'
  if (/(done|succeed|finished|shipped|merged)/i.test(type)) return 'ok'
  if (/(start|burn|launch|advance|running|retry|resum)/i.test(type)) return 'active'
  return 'info'
}
