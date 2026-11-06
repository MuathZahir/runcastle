// Token accounting (decision 3): what a session actually spent, summed over its
// transcript. Pure — the caller reads the file and hands us its TEXT, and sums
// a Claude Code session's subagent transcripts in by calling this once per file.
//
// Tokens, never dollars, and never a limit (decision 2). `honest-token-counts`
// adds a derived cost figure, weighted tokens ({@link weightedTokens}), worked
// out from the split on read and never stored.

/** The runtimes whose transcripts this can sum — the `AgentRuntime` values. */
export type UsageRuntime = 'claude-code' | 'codex'

/** One session's (or many sessions') token spend, split by kind. */
export interface TokenUsage {
  /** Uncached input. */
  input: number
  /** Every cache write, 5-minute and 1-hour together. */
  cacheCreation: number
  /** The 1-hour share of `cacheCreation` (the rest is 5-minute writes). */
  cacheCreation1h: number
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

/** A usage split without its total — what a breakdown stores per purpose. */
export type UsageSplit = Omit<TokenUsage, 'total'>

/**
 * The `token_breakdown` JSON beside a ticket's or session's `tokens`: the split
 * by kind, plus the agent session ids it was summed from (a ticket's, so a
 * worker can be reopened later) and the transcript mtime it was summed at (a
 * session's, so a read re-sums only a transcript that has grown since).
 *
 * `cacheCreation1h` is absent on rows counted before it existed: read it as 0
 * there (every such write then prices as a 5-minute one).
 */
export interface TokenBreakdown extends Omit<UsageSplit, 'cacheCreation1h'> {
  cacheCreation1h?: number
  sessionIds?: string[]
  countedAt?: number
  /**
   * A session's split by the purpose of the launch that wrote each message
   * (`honest-token-counts` decision 1): `self-plan`, `resolve-conflict`…, and
   * `none` for a launch with no errand. Sums to the row's split.
   */
  byPurpose?: Record<string, UsageSplit>
  /**
   * The whole conversation's total at the last count — what a later count
   * compares against so a transcript the CLI cut short never lowers a figure.
   */
  conversationTotal?: number
  /**
   * False on a row the one-time recount could not redo because its transcript
   * was gone; its figure is the old one, collapsed so the conversation counts once.
   */
  recounted?: boolean
}

export const ZERO_USAGE: TokenUsage = { input: 0, cacheCreation: 0, cacheCreation1h: 0, cacheRead: 0, output: 0, total: 0 }

/** Two usages added, kind by kind. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheCreation1h: a.cacheCreation1h + b.cacheCreation1h,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    total: a.total + b.total,
  }
}

/** A split (or a stored breakdown) as a usage with its total. */
export function usageOf(parts: Omit<UsageSplit, 'cacheCreation1h'> & { cacheCreation1h?: number }): TokenUsage {
  return {
    input: parts.input,
    cacheCreation: parts.cacheCreation,
    cacheCreation1h: parts.cacheCreation1h ?? 0,
    cacheRead: parts.cacheRead,
    output: parts.output,
    total: parts.input + parts.cacheCreation + parts.cacheRead + parts.output,
  }
}

/** A usage without its total. */
export function splitOf(usage: TokenUsage): UsageSplit {
  const { total: _total, ...split } = usage
  return split
}

/**
 * What each kind of token costs, as a multiple of an uncached input token
 * (`honest-token-counts` decision 6). The ratios hold across Claude models and
 * price changes; Codex has no cache writes and its output ratio is close enough
 * for comparing one fix against another.
 */
export const TOKEN_WEIGHTS = {
  input: 1,
  cacheRead: 0.1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  output: 5,
} as const

/** Weighted tokens: the split priced as uncached input. Accepts a stored breakdown. */
export function weightedTokens(split: Omit<UsageSplit, 'cacheCreation1h'> & { cacheCreation1h?: number }): number {
  const oneHour = split.cacheCreation1h ?? 0
  return (
    split.input * TOKEN_WEIGHTS.input +
    split.cacheRead * TOKEN_WEIGHTS.cacheRead +
    (split.cacheCreation - oneHour) * TOKEN_WEIGHTS.cacheWrite5m +
    oneHour * TOKEN_WEIGHTS.cacheWrite1h +
    split.output * TOKEN_WEIGHTS.output
  )
}

/** A finite non-negative count, or 0 for anything else a CLI wrote there. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

type Line = Record<string, unknown>

/**
 * The JSON objects of a JSONL text, skipping blanks and torn lines. `mark`, when
 * given, skips without parsing every line that does not contain it — most of a
 * transcript is tool output no count needs, and parsing it is the cost.
 */
function* lines(jsonl: string, mark?: string): Generator<Line> {
  for (const raw of jsonl.split('\n')) {
    if (mark !== undefined && !raw.includes(mark)) continue
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

function stampOf(line: Line): number | null {
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN
  return Number.isNaN(at) ? null : at
}

function inWindow(at: number | null, window: UsageWindow | undefined): boolean {
  if (!window || (window.from === undefined && window.to === undefined)) return true
  if (at === null) return false
  return (window.from === undefined || at >= window.from) && (window.to === undefined || at <= window.to)
}

/** One counted model response: when it was written (null when unstamped) and what it spent. */
export interface CountedMessage {
  at: number | null
  usage: TokenUsage
}

/**
 * Claude Code: every assistant line carries `message.usage`, and one API
 * response streamed as several content blocks writes several lines sharing a
 * `message.id` — so each id counts once (its last line). The 1-hour share of
 * the cache writes is `usage.cache_creation.ephemeral_1h_input_tokens`; lines
 * written before the CLI split it count every write as 5-minute.
 */
function claudeMessages(jsonl: string): CountedMessage[] {
  const byMessage = new Map<string, CountedMessage>()
  const anonymous: CountedMessage[] = []
  for (const line of lines(jsonl, '"usage"')) {
    if (line.type !== 'assistant') continue
    const message = line.message as { id?: unknown; usage?: Record<string, unknown> } | undefined
    const usage = message?.usage
    if (!usage) continue
    const split = usage.cache_creation as Record<string, unknown> | undefined
    const counted: CountedMessage = {
      at: stampOf(line),
      usage: usageOf({
        input: count(usage.input_tokens),
        cacheCreation: count(usage.cache_creation_input_tokens),
        cacheCreation1h: Math.min(count(split?.ephemeral_1h_input_tokens), count(usage.cache_creation_input_tokens)),
        cacheRead: count(usage.cache_read_input_tokens),
        output: count(usage.output_tokens),
      }),
    }
    if (typeof message.id === 'string') {
      // Re-inserting keeps the map in first-seen order while the last line's figures win.
      byMessage.delete(message.id)
      byMessage.set(message.id, counted)
    } else anonymous.push(counted)
  }
  return [...anonymous, ...byMessage.values()]
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
 * `turn.completed` lines with a `usage` per turn. Either way: one per turn.
 */
function codexMessages(jsonl: string): CountedMessage[] {
  const out: CountedMessage[] = []
  let lastRunningTotal: string | undefined
  for (const line of lines(jsonl)) {
    if (line.type === 'turn.completed') {
      const usage = line.usage as Record<string, unknown> | undefined
      if (usage) out.push({ at: stampOf(line), usage: codexUsage(usage) })
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
    if (repeat) continue
    out.push({ at: stampOf(line), usage: codexUsage(turn) })
  }
  return out
}

/**
 * Every model response one transcript's text records, each counted once, with
 * when it was written — what a conversation's count splits across the launches
 * that wrote it (`honest-token-counts` decision 1). A file in a shape we do not
 * know yields nothing rather than throwing: the transcript belongs to the CLI,
 * and its format can shift under us.
 */
export function countedMessages(text: string, runtime: UsageRuntime): CountedMessage[] {
  return runtime === 'codex' ? codexMessages(text) : claudeMessages(text)
}

/**
 * The tokens one transcript's text records, as its runtime writes them —
 * optionally only the messages stamped inside `window`.
 */
export function sumSessionUsage(text: string, runtime: UsageRuntime, window?: UsageWindow): TokenUsage {
  return countedMessages(text, runtime)
    .filter((m) => inWindow(m.at, window))
    .reduce((sum, m) => addUsage(sum, m.usage), ZERO_USAGE)
}
