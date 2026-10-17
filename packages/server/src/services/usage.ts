import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  type AgentRuntime,
  addUsage,
  DEFAULT_RUNTIME,
  type TokenBreakdown,
  type TokenUsage,
  sumSessionUsage,
  type UsageWindow,
  ZERO_USAGE,
} from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { sessions, tickets } from '../db/schema'
import type { AppCtx } from '../db/types'
import { emit, emitForSession } from './events'
import { listSessionsByFeature, rowToSession } from './repo'
import { listByFeature as listTickets } from './tickets'

/**
 * Token telemetry (`the-feature-lead-runs-rounds` decision 3): what the
 * workers and the lead actually spent, summed over their transcripts — the
 * IO half of core's `sumSessionUsage`. Tokens only, never cost, never a limit.
 *
 * Best-effort throughout: a transcript belongs to the CLI, so one that is gone
 * or unreadable is "not counted" (null), never an error.
 */

/** One transcript's text, with its Claude Code subagent transcripts beside it. */
interface TranscriptTexts {
  texts: string[]
  /** The newest mtime among the files read — what "has it grown since" compares. */
  mtime: number
}

/**
 * Claude Code keeps a session's subagent transcripts at
 * `<dir>/<session-id>/subagents/agent-*.jsonl`, next to `<dir>/<session-id>.jsonl`.
 * Codex has no such side files.
 */
function subagentTranscripts(path: string, runtime: AgentRuntime): string[] {
  if (runtime !== 'claude-code') return []
  const dir = join(dirname(path), basename(path, '.jsonl'), 'subagents')
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('agent-') && name.endsWith('.jsonl'))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/** The texts of a transcript and its subagents', or null when the main file cannot be read. */
function readTranscriptTexts(path: string, runtime: AgentRuntime): TranscriptTexts | null {
  let texts: string[]
  let mtime: number
  try {
    texts = [readFileSync(path, 'utf8')]
    mtime = statSync(path).mtimeMs
  } catch {
    return null
  }
  for (const sub of subagentTranscripts(path, runtime)) {
    try {
      texts.push(readFileSync(sub, 'utf8'))
      mtime = Math.max(mtime, statSync(sub).mtimeMs)
    } catch {
      // A subagent file torn away mid-read only loses its own share.
    }
  }
  return { texts, mtime }
}

function sumTexts(texts: string[], runtime: AgentRuntime, window?: UsageWindow): TokenUsage {
  return texts.map((text) => sumSessionUsage(text, runtime, window)).reduce(addUsage, ZERO_USAGE)
}

/**
 * The summed usage of one transcript file and its subagent transcripts, or
 * null when the transcript cannot be read at all.
 */
export function readTranscriptUsage(path: string, runtime: AgentRuntime): TokenUsage | null {
  const read = readTranscriptTexts(path, runtime)
  return read ? sumTexts(read.texts, runtime) : null
}

/** The split a breakdown stores — the usage without its total. */
export function breakdownOf(usage: TokenUsage): TokenBreakdown {
  const { total: _total, ...parts } = usage
  return parts
}

/**
 * Add one worker run's usage to a ticket's tokens (decision 3), accumulating
 * across the ticket's iterations, attempts and rounds, and remember the agent
 * session ids it came from — the parked "Open a worker while it works" wants
 * them. Emits `ticket.tokens_counted`.
 */
export function addTicketTokens(ctx: AppCtx, ticketId: string, usage: TokenUsage, sessionIds: string[]): void {
  const row = ctx.db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!row) return
  const prior = row.tokenBreakdown
  const sum = addUsage(
    prior
      ? {
          input: prior.input,
          cacheCreation: prior.cacheCreation,
          cacheRead: prior.cacheRead,
          output: prior.output,
          total: row.tokens ?? 0,
        }
      : ZERO_USAGE,
    usage,
  )
  const ids = [...new Set([...(prior?.sessionIds ?? []), ...sessionIds])]
  ctx.db
    .update(tickets)
    .set({ tokens: sum.total, tokenBreakdown: { ...breakdownOf(sum), ...(ids.length > 0 ? { sessionIds: ids } : {}) } })
    .where(eq(tickets.id, ticketId))
    .run()
  emit(ctx, row.featureId, {
    type: 'ticket.tokens_counted',
    message: `ticket ${row.seq} tokens: ${sum.total}`,
    ticketId,
    data: { tokens: sum.total, added: usage.total },
  })
}

/**
 * A lazy read re-sums a session only when its transcript has grown by more
 * than this since the last count, so a lead mid-turn — whose file grows with
 * every line — does not re-sum and re-emit on every poll of the page.
 */
const LAZY_STALE_MS = 30_000

/**
 * Re-sum a session's transcript into `sessions.tokens` (decision 3) and emit
 * `session.tokens_counted` when the total moved. `lazy` is the read path:
 * it skips a transcript that has not grown materially since the last count.
 * Returns the session's tokens after the refresh, or null when uncounted.
 */
export function refreshSessionTokens(
  ctx: AppCtx,
  sessionId: string,
  opts: { lazy?: boolean } = {},
): number | null {
  const row = ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!row?.transcriptPath) return row?.tokens ?? null
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const countedAt = row.tokenBreakdown?.countedAt
  if (opts.lazy && countedAt !== undefined) {
    try {
      if (statSync(row.transcriptPath).mtimeMs < countedAt + LAZY_STALE_MS) return row.tokens
    } catch {
      return row.tokens
    }
  }
  const read = readTranscriptTexts(row.transcriptPath, runtime)
  if (!read) return row.tokens
  const usage = sumTexts(read.texts, runtime)
  ctx.db
    .update(sessions)
    .set({ tokens: usage.total, tokenBreakdown: { ...breakdownOf(usage), countedAt: read.mtime } })
    .where(eq(sessions.id, sessionId))
    .run()
  if (usage.total !== row.tokens) {
    emitForSession(ctx, rowToSession(row), {
      type: 'session.tokens_counted',
      message: `session tokens counted: ${usage.total}`,
      data: { sessionId, tokens: usage.total },
    })
  }
  return usage.total
}

/** The feature's chat sessions — its lead, across every launch of it. */
function leadSessions(ctx: AppCtx, featureId: string) {
  return listSessionsByFeature(ctx, featureId).filter((s) => s.kind === 'chat')
}

/** Refresh the tokens of the feature's lead session(s) — at a round's end, and lazily on read. */
export function refreshLeadTokens(ctx: AppCtx, featureId: string, opts: { lazy?: boolean } = {}): void {
  for (const session of leadSessions(ctx, featureId)) refreshSessionTokens(ctx, session.id, opts)
}

/**
 * A reader of the lead's usage inside a window: the lead's transcripts are read
 * once, then summed per window — one call per round on the trail. Returns 0
 * for a window the lead spent nothing in, and for a lead with no transcript.
 */
export function leadUsageReader(ctx: AppCtx, featureId: string): (window: UsageWindow) => number {
  const transcripts = leadSessions(ctx, featureId).flatMap((s) => {
    if (!s.transcriptPath) return []
    const runtime = s.runtime ?? DEFAULT_RUNTIME
    const read = readTranscriptTexts(s.transcriptPath, runtime)
    return read ? [{ texts: read.texts, runtime }] : []
  })
  return (window) =>
    transcripts.reduce((sum, t) => sum + sumTexts(t.texts, t.runtime, window).total, 0)
}

/**
 * The feature's whole token spend for its header (decision 3): every ticket's
 * workers plus every one of the feature's sessions, the lead's refreshed lazily
 * first. Null when nothing has been counted yet.
 */
export function featureTokensTotal(ctx: AppCtx, featureId: string): number | null {
  refreshLeadTokens(ctx, featureId, { lazy: true })
  const counts = [
    ...listTickets(ctx, featureId).map((t) => t.tokens),
    ...listSessionsByFeature(ctx, featureId).map((s) => s.tokens),
  ].filter((n): n is number => n !== undefined)
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null
}
