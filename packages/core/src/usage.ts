// Token accounting (decision 3): what a session actually spent, summed over its
// transcript. Pure — the caller reads the file and hands us its TEXT, and sums
// a Claude Code session's subagent transcripts in by calling this once per file.
//
// Tokens only, never cost, and never a limit (decision 2).

/** The runtimes whose transcripts this can sum — the `AgentRuntime` values. */
export type UsageRuntime = 'claude-code' | 'codex'

/** One session's (or many sessions') token spend, split by kind. */
export interface TokenUsage {
  /** Uncached input. */
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  /** input + cacheCreation + cacheRead + output. */
  total: number
}

/** The window a sum may be limited to, in epoch ms, both ends inclusive and optional. */
export interface UsageWindow {
  from?: number
  to?: number
}

/**
 * The `token_breakdown` JSON beside a ticket's or session's `tokens`: the split
 * by kind, plus the agent session ids it was summed from (a ticket's, so a
 * worker can be reopened later) and the transcript mtime it was summed at (a
 * session's, so a read re-sums only a transcript that has grown since).
 */
export interface TokenBreakdown extends Omit<TokenUsage, 'total'> {
  sessionIds?: string[]
  countedAt?: number
}

export const ZERO_USAGE: TokenUsage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 }

/** Two usages added, kind by kind. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    total: a.total + b.total,
  }
}

function usageOf(parts: Omit<TokenUsage, 'total'>): TokenUsage {
  return { ...parts, total: parts.input + parts.cacheCreation + parts.cacheRead + parts.output }
}

/** A finite non-negative count, or 0 for anything else a CLI wrote there. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

type Line = Record<string, unknown>

/** The JSON objects of a JSONL text, skipping blanks and torn lines. */
function* lines(jsonl: string): Generator<Line> {
  for (const raw of jsonl.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') yield parsed as Line
    } catch {
      // A torn final line — the CLI may still be appending.
    }
  }
}

function inWindow(line: Line, window: UsageWindow | undefined): boolean {
  if (!window || (window.from === undefined && window.to === undefined)) return true
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN
  if (Number.isNaN(at)) return false
  return (window.from === undefined || at >= window.from) && (window.to === undefined || at <= window.to)
}

/**
 * Claude Code: every assistant line carries `message.usage`, and one API
 * response streamed as several content blocks writes several lines sharing a
 * `message.id` with the same usage — so each id counts once (its last line).
 */
function sumClaude(jsonl: string, window: UsageWindow | undefined): TokenUsage {
  const byMessage = new Map<string, TokenUsage>()
  let anonymous = ZERO_USAGE
  for (const line of lines(jsonl)) {
    if (line.type !== 'assistant' || !inWindow(line, window)) continue
    const message = line.message as { id?: unknown; usage?: Record<string, unknown> } | undefined
    const usage = message?.usage
    if (!usage) continue
    const counted = usageOf({
      input: count(usage.input_tokens),
      cacheCreation: count(usage.cache_creation_input_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      output: count(usage.output_tokens),
    })
    if (typeof message.id === 'string') byMessage.set(message.id, counted)
    else anonymous = addUsage(anonymous, counted)
  }
  return [...byMessage.values()].reduce(addUsage, anonymous)
}

/**
 * Codex counts cached input INSIDE `input_tokens`; ours are disjoint kinds, so
 * the cached share moves to `cacheRead`. Codex has no cache-creation figure.
 */
function codexUsage(usage: Record<string, unknown>): TokenUsage {
  const cached = count(usage.cached_input_tokens)
  return usageOf({
    input: Math.max(0, count(usage.input_tokens) - cached),
    cacheCreation: 0,
    cacheRead: cached,
    output: count(usage.output_tokens),
  })
}

/**
 * Codex: the rollout's `event_msg` `token_count` events each carry the last
 * model turn's usage (`info.last_token_usage`) beside the running total; Codex
 * re-emits an unchanged event when only its rate limits move, recognised by a
 * running total that did not change. `codex exec --json` streams instead write
 * `turn.completed` lines with a `usage` per turn. Either way: summed per turn.
 */
function sumCodex(jsonl: string, window: UsageWindow | undefined): TokenUsage {
  let sum = ZERO_USAGE
  let lastRunningTotal: string | undefined
  for (const line of lines(jsonl)) {
    if (line.type === 'turn.completed') {
      const usage = line.usage as Record<string, unknown> | undefined
      if (usage && inWindow(line, window)) sum = addUsage(sum, codexUsage(usage))
      continue
    }
    if (line.type !== 'event_msg') continue
    const payload = line.payload as { type?: unknown; info?: Record<string, unknown> | null } | undefined
    if (payload?.type !== 'token_count' || !payload.info) continue
    const turn = payload.info.last_token_usage as Record<string, unknown> | undefined
    if (!turn) continue
    const runningTotal = JSON.stringify(payload.info.total_token_usage ?? null)
    const repeat = payload.info.total_token_usage !== undefined && runningTotal === lastRunningTotal
    lastRunningTotal = runningTotal
    if (repeat || !inWindow(line, window)) continue
    sum = addUsage(sum, codexUsage(turn))
  }
  return sum
}

/**
 * The tokens one transcript's text records, as its runtime writes them —
 * optionally only the lines stamped inside `window`. A file in a shape we do
 * not know sums to zero rather than throwing: the transcript belongs to the
 * CLI, and its format can shift under us.
 */
export function sumSessionUsage(text: string, runtime: UsageRuntime, window?: UsageWindow): TokenUsage {
  return runtime === 'codex' ? sumCodex(text, window) : sumClaude(text, window)
}
