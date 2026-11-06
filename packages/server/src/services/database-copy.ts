import { existsSync, writeFileSync } from 'node:fs'
import type { SessionRow } from '@runcastle/core'
import { eq, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { pushSubscriptions, runs, sessions, tickets } from '../db/schema'
import { hasThreadLog } from '../threads/log'

/**
 * A server booted on a COPY of another install's database
 * (`drives-never-touch-real-conversations`): a test drive of runcastle, whose
 * setup snapshots the live database into the drive's data dir and sets this
 * variable in the drive's environment. Claude Code's and Codex's own config
 * dirs are shared with the live install, so every conversation id, running run,
 * drive slot and phone subscription in the copy still points at the live one.
 */
export const DATABASE_IS_COPY_ENV = 'RUNCASTLE_DATABASE_IS_COPY'

/** Whether this server's database is a copy of another install's (decision 1). */
export function isDatabaseCopy(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DATABASE_IS_COPY_ENV] === '1'
}

/** What a run the live install was still running reads as in the copy (decision 3). */
export const COPIED_WHILE_RUNNING = 'still running in your real runcastle when this drive started'

export interface DetachResult {
  conversations: number
  runs: number
  tickets: number
  pushSubscriptions: number
}

/**
 * Cut a copied database loose from the install it was copied from, before boot
 * reconciles or wakes anything (decisions 1-6):
 *
 * - every session's conversation id goes, so nothing continues, forks or
 *   rewinds a live conversation; the transcript path stays, so history still
 *   reads back (decisions 2 and 6);
 * - every `running` run, and the ticket lanes it left `burning`, close quietly:
 *   no events, so no lead is woken and no holder hears it, and no git, so no
 *   chat branch is landed on a real feature branch (decision 3);
 * - phone subscriptions go, so the drive never pings the human's real phone
 *   (decision 5).
 *
 * Records are updated, never deleted (decision 6). Run it once per copy
 * ({@link detachCopyOnce}): run again it would also cut the conversations the
 * drive itself began.
 */
export function detachCopiedDatabase(ctx: AppCtx, now = Date.now()): DetachResult {
  return ctx.db.transaction((tx) => {
    const conversations = tx
      .update(sessions)
      .set({ ccSessionId: null })
      .where(isNotNull(sessions.ccSessionId))
      .returning({ id: sessions.id })
      .all().length
    const closedRuns = tx
      .update(runs)
      .set({ status: 'failed', endedAt: now, summary: COPIED_WHILE_RUNNING })
      .where(eq(runs.status, 'running'))
      .returning({ id: runs.id })
      .all().length
    const closedTickets = tx
      .update(tickets)
      .set({ status: 'failed', error: COPIED_WHILE_RUNNING })
      .where(eq(tickets.status, 'burning'))
      .returning({ id: tickets.id })
      .all().length
    const subscriptions = tx.delete(pushSubscriptions).returning({ endpoint: pushSubscriptions.endpoint }).all().length
    return { conversations, runs: closedRuns, tickets: closedTickets, pushSubscriptions: subscriptions }
  })
}

/**
 * Whether runcastle may send a background message (orchestrator news, a wake no
 * click asked for) to this thread (decision 9). On a live install, always. On a
 * copy, only to a thread whose conversation began here: one with a conversation
 * id of its own (the copied ones were cleared at boot) or a thread log, which
 * lives in the data dir and so was never copied.
 */
export function mayStartInBackground(
  thread: Pick<SessionRow, 'id' | 'ccSessionId'> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isDatabaseCopy(env)) return true
  return !!thread && (!!thread.ccSessionId || hasThreadLog(thread.id))
}

/**
 * The file that says a copy was already detached: beside the database, so the
 * drive setup's "delete the old database files" step removes it with them and
 * every fresh copy is detached again.
 */
export function detachedMarkerPath(databasePath: string): string {
  return `${databasePath}-detached`
}

/**
 * Boot's entry (decision 1): on a copy, detach it the first time this server
 * boots on it, and never again — a restart or `bun --hot` reload inside the
 * same drive keeps the conversations the drive began. Null when there was
 * nothing to do.
 */
export function detachCopyOnce(ctx: AppCtx, databasePath: string, env: NodeJS.ProcessEnv = process.env): DetachResult | null {
  if (!isDatabaseCopy(env)) return null
  const marker = detachedMarkerPath(databasePath)
  if (existsSync(marker)) return null
  const result = detachCopiedDatabase(ctx)
  writeFileSync(marker, `${new Date().toISOString()}\n`)
  return result
}
