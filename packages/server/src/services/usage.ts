import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  type AgentRuntime,
  addUsage,
  countedMessages,
  DEFAULT_RUNTIME,
  splitOf,
  type TokenBreakdown,
  type TokenUsage,
  sumSessionUsage,
  type UsageSplit,
  ZERO_USAGE,
} from '@runcastle/core'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { events, sessions } from '../db/schema'
import type { AppCtx } from '../db/types'
import { emitForSession } from './events'
import { rowToSession } from './repo'

type SessionSelect = typeof sessions.$inferSelect

/**
 * Token telemetry (`the-feature-lead-runs-rounds` decision 3, made honest by
 * `honest-token-counts`): what every session and worker actually spent,
 * summed over their transcripts — the IO half of core's `countedMessages`.
 * Tokens and their split, never dollars, never a limit; cost is read as
 * weighted tokens, worked out from the split (see that feature's spec for the
 * query that sums them).
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

function sumTexts(texts: string[], runtime: AgentRuntime): TokenUsage {
  return texts.map((text) => sumSessionUsage(text, runtime)).reduce(addUsage, ZERO_USAGE)
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
export function breakdownOf(usage: TokenUsage): UsageSplit {
  return splitOf(usage)
}

/**
 * A lazy read re-sums a conversation only when its transcript has grown by more
 * than this since the last count, so a lead mid-turn — whose file grows with
 * every line — does not re-sum and re-emit on every poll of the page.
 */
const LAZY_STALE_MS = 30_000

/**
 * How eagerly a count runs: `lazy` (a page read: only a transcript grown by
 * more than {@link LAZY_STALE_MS}), `turn` (a turn ended: any transcript that
 * changed since the last count) or `full` (a session ended, the one-time
 * recount: always).
 */
export type CountMode = 'lazy' | 'turn' | 'full'

/** What a conversation's count did. */
export type CountOutcome = 'counted' | 'unchanged' | 'missing' | 'shrunk'

/** The purpose a launch with no errand is filed under. */
export const NO_PURPOSE = 'none'

/** One launch of a conversation: which row it ran under, from when, on what errand. */
interface Launch {
  sessionId: string
  at: number
  purpose: string
}

/**
 * The events that start a launch, or change the errand of the one running.
 * `session.self_plan_ended` carries no purpose, so it ends a planning errand —
 * the one record of that change in the rows from before `session.purpose_set`.
 */
const LAUNCH_EVENTS = ['session.launching', 'session.purpose_set', 'session.self_plan_ended']

/**
 * The launches of a conversation's rows, oldest first: the launch records the
 * launcher writes (`session.launching`) and every change of a row's purpose
 * (`session.purpose_set`, and the older `session.self_plan_ended`). A row with neither — a fixture, a row from before
 * the events — is one launch at its creation, on its own purpose.
 */
function launchesOf(ctx: AppCtx, rows: SessionSelect[]): Launch[] {
  const ids = rows.map((r) => r.id)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const sessionIdOf = sql<string>`json_extract(${events.data}, '$.sessionId')`
  const recorded = ctx.db
    .select({ ts: events.ts, data: events.data, sessionId: sessionIdOf })
    .from(events)
    .where(and(inArray(events.type, LAUNCH_EVENTS), inArray(sessionIdOf, ids)))
    .orderBy(asc(events.id))
    .all()
    .map((e) => {
      const purpose = (e.data as { purpose?: unknown } | null)?.purpose
      const row = byId.get(e.sessionId)
      // Only a main chat's purpose ever changes; any other row keeps the one it
      // was created with, which launch records before this feature left out.
      const fallback = row && row.kind !== 'chat' ? (row.purpose ?? NO_PURPOSE) : NO_PURPOSE
      return { sessionId: e.sessionId, at: e.ts, purpose: typeof purpose === 'string' ? purpose : fallback }
    })
  const seen = new Set(recorded.map((l) => l.sessionId))
  const unrecorded = rows
    .filter((r) => !seen.has(r.id))
    .map((r) => ({ sessionId: r.id, at: r.createdAt ?? 0, purpose: r.purpose ?? NO_PURPOSE }))
  // Stable: launches at the same instant keep their recorded order.
  return [...unrecorded, ...recorded].sort((a, b) => a.at - b.at)
}

/** The launch running at `at`: the newest started at or before it, else the first. */
function launchAt(launches: Launch[], at: number | null): Launch {
  if (at === null) return launches[0] as Launch
  let lo = 0
  let hi = launches.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((launches[mid] as Launch).at <= at) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return launches[found] as Launch
}

/** A conversation's rows, oldest first. */
function conversationRows(ctx: AppCtx, transcriptPath: string): SessionSelect[] {
  return ctx.db.select().from(sessions).where(eq(sessions.transcriptPath, transcriptPath)).orderBy(sql`rowid`).all()
}

/** The figure a conversation stood at when last counted, under either scheme. */
function priorConversationTotal(rows: SessionSelect[]): number {
  return Math.max(0, ...rows.map((r) => r.tokenBreakdown?.conversationTotal ?? r.tokens ?? 0))
}

/**
 * Count one conversation (`honest-token-counts` decision 1): every message in
 * its transcript, sub-agents included, counted once and filed under the launch
 * that was running when it was written — its row, and that launch's purpose.
 * Every row sharing the transcript gets its own share, so the rows sum to the
 * conversation, and each row keeps its share split by purpose.
 *
 * Never lowers a figure on a transcript that is gone or shorter than at the
 * last count (decision 3): the CLI deletes and trims its files, and a good
 * figure beats none. Emits `session.tokens_counted` for each row whose total moved.
 */
export function countConversation(ctx: AppCtx, transcriptPath: string, mode: CountMode = 'full'): CountOutcome {
  const rows = conversationRows(ctx, transcriptPath)
  if (rows.length === 0) return 'missing'
  const runtime = rows[rows.length - 1]?.runtime ?? DEFAULT_RUNTIME
  const countedAt = Math.max(...rows.map((r) => r.tokenBreakdown?.countedAt ?? Number.NEGATIVE_INFINITY))
  if (mode !== 'full' && Number.isFinite(countedAt)) {
    let mtime: number
    try {
      mtime = statSync(transcriptPath).mtimeMs
    } catch {
      return 'missing'
    }
    if (mode === 'lazy' ? mtime < countedAt + LAZY_STALE_MS : mtime <= countedAt) return 'unchanged'
  }
  const read = readTranscriptTexts(transcriptPath, runtime)
  if (!read) return 'missing'
  const messages = read.texts.flatMap((text) => countedMessages(text, runtime))
  const total = messages.reduce((n, m) => n + m.usage.total, 0)
  if (total < priorConversationTotal(rows)) return 'shrunk'

  const launches = launchesOf(ctx, rows)
  const shares = new Map<string, { usage: TokenUsage; byPurpose: Map<string, TokenUsage> }>(
    rows.map((r) => [r.id, { usage: ZERO_USAGE, byPurpose: new Map() }]),
  )
  for (const message of messages) {
    const launch = launchAt(launches, message.at)
    const share = shares.get(launch.sessionId)
    if (!share) continue
    share.usage = addUsage(share.usage, message.usage)
    share.byPurpose.set(launch.purpose, addUsage(share.byPurpose.get(launch.purpose) ?? ZERO_USAGE, message.usage))
  }

  for (const row of rows) {
    const share = shares.get(row.id) as { usage: TokenUsage; byPurpose: Map<string, TokenUsage> }
    const byPurpose = Object.fromEntries([...share.byPurpose].map(([purpose, usage]) => [purpose, splitOf(usage)]))
    ctx.db
      .update(sessions)
      .set({
        tokens: share.usage.total,
        tokenBreakdown: {
          ...splitOf(share.usage),
          byPurpose,
          countedAt: read.mtime,
          conversationTotal: total,
          recounted: true,
        },
      })
      .where(eq(sessions.id, row.id))
      .run()
    if (share.usage.total !== row.tokens) {
      emitForSession(ctx, rowToSession(row), {
        type: 'session.tokens_counted',
        message: `session tokens counted: ${share.usage.total}`,
        data: { sessionId: row.id, tokens: share.usage.total },
      })
    }
  }
  return 'counted'
}

/**
 * Re-count the conversation a session belongs to (decisions 1, 3). Best-effort:
 * it never throws, so a turn's end or a session's teardown cannot fail over a
 * count. Returns the session's tokens afterwards, or null when uncounted.
 */
export function refreshSessionTokens(ctx: AppCtx, sessionId: string, opts: { mode?: CountMode } = {}): number | null {
  try {
    const row = ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!row?.transcriptPath) return row?.tokens ?? null
    countConversation(ctx, row.transcriptPath, opts.mode ?? 'full')
    return ctx.db.select({ tokens: sessions.tokens }).from(sessions).where(eq(sessions.id, sessionId)).get()?.tokens ?? null
  } catch {
    return null
  }
}

/**
 * Refresh every conversation of the feature, whatever its kind (decision 2) —
 * at a round's end, and lazily on a read of the feature.
 */
export function refreshFeatureTokens(ctx: AppCtx, featureId: string, opts: { mode?: CountMode } = {}): void {
  const paths = new Set(
    ctx.db
      .select({ path: sessions.transcriptPath })
      .from(sessions)
      .where(eq(sessions.featureId, featureId))
      .all()
      .map((r) => r.path)
      .filter((p): p is string => !!p),
  )
  for (const path of paths) {
    try {
      countConversation(ctx, path, opts.mode ?? 'full')
    } catch {
      // Best-effort: one unreadable conversation never stops the others.
    }
  }
}

/**
 * Settle a conversation the recount cannot redo (its transcript is gone, or
 * shorter than its old figure), decision 4. Rows from before this feature each
 * held the whole conversation, so the row that held the largest figure gives it,
 * with its split, to the newest row; the rest go to zero. A conversation this
 * feature already counted is honest as it stands: only its rows never counted
 * are marked. Every row ends marked not recounted, so the recount does not
 * visit it again, and each row whose total moved emits `session.tokens_counted`.
 */
function collapseConversation(ctx: AppCtx, transcriptPath: string): void {
  const rows = conversationRows(ctx, transcriptPath)
  const honest = rows.some((r) => r.tokenBreakdown?.conversationTotal !== undefined)
  const largest = rows
    .filter((r) => r.tokens !== null)
    .reduce<SessionSelect | undefined>((best, r) => (!best || (r.tokens ?? 0) > (best.tokens ?? 0) ? r : best), undefined)
  const newest = rows[rows.length - 1]
  for (const row of rows) {
    let tokens: number | null
    let breakdown: TokenBreakdown
    if (honest) {
      if (row.tokenBreakdown?.conversationTotal !== undefined) continue
      tokens = row.tokens
      breakdown = { ...(row.tokenBreakdown ?? splitOf(ZERO_USAGE)), recounted: false }
    } else if (!largest) {
      tokens = null
      breakdown = { ...splitOf(ZERO_USAGE), recounted: false }
    } else if (row === newest) {
      tokens = largest.tokens
      breakdown = { ...(largest.tokenBreakdown ?? splitOf(ZERO_USAGE)), recounted: false }
    } else {
      tokens = 0
      breakdown = { ...splitOf(ZERO_USAGE), recounted: false }
    }
    ctx.db.update(sessions).set({ tokens, tokenBreakdown: breakdown }).where(eq(sessions.id, row.id)).run()
    if (tokens !== row.tokens) {
      emitForSession(ctx, rowToSession(row), {
        type: 'session.tokens_counted',
        message: `session tokens settled by the recount: ${tokens ?? 'none'}`,
        data: { sessionId: row.id, tokens },
      })
    }
  }
}

/**
 * The one-time recount (decision 4): every conversation not yet counted under
 * the honest rules is recounted from its transcript, or collapsed when that is
 * gone. Self-marking — a counted row carries its `conversationTotal`, a
 * collapsed one `recounted: false` — so it does nothing on later boots. Yields
 * between conversations, so a boot with many large transcripts stays responsive.
 */
export async function recountAllSessions(ctx: AppCtx): Promise<{ recounted: number; collapsed: number }> {
  const conversationTotal = sql`json_extract(${sessions.tokenBreakdown}, '$.conversationTotal')`
  const recounted = sql`json_extract(${sessions.tokenBreakdown}, '$.recounted')`
  const paths = new Set(
    ctx.db
      .select({ path: sessions.transcriptPath })
      .from(sessions)
      .where(
        and(
          isNotNull(sessions.transcriptPath),
          sql`${conversationTotal} IS NULL`,
          sql`(${recounted} IS NULL OR ${recounted} != 0)`,
        ),
      )
      .all()
      .map((r) => r.path as string),
  )
  const result = { recounted: 0, collapsed: 0 }
  for (const path of paths) {
    try {
      const outcome = countConversation(ctx, path, 'full')
      if (outcome === 'counted') result.recounted++
      else {
        collapseConversation(ctx, path)
        result.collapsed++
      }
    } catch {
      // Best-effort, like every count.
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  return result
}
