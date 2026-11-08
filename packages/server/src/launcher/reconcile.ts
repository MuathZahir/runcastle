import { foldThread, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { mayStartInBackground } from '../services/database-copy'
import { emitForSession } from '../services/events'
import { rowToSession, tryGetFeature } from '../services/repo'
import { hasThreadLog } from '../threads/log'
import { agentHost, appendThreadEvent, readThreadEvents } from '../threads/types'
import { getWorker } from '../workers/service'
import { markSessionEnded } from './sessions'

/**
 * Boot reconciliation (E2E finding, severity 1). Agent processes are children
 * of the server, so after a cold start every `launching`/`live` session row is
 * stale by definition — its process died with the old server. Each is marked
 * `ended` with ONE `session.reconciled` event; to the human its thread is
 * simply idle, and its next prompt starts it again.
 *
 * A thread's log cut off mid-turn (or mid-ask) by the restart would still fold
 * as working or waiting, so its log is closed with a `process stopped` event
 * marked `restarted`, and it folds idle, its cut-off turn saying the restart
 * interrupted it rather than "Stopped by you".
 *
 * `bun --hot` safety: the agent host survives hot reloads on `globalThis`, so a
 * thread whose process is genuinely still running is skipped.
 *
 * Every thread whose log it closes that way is added to `cutOff`, for
 * {@link wakeCutOffChats} once the server listens.
 */
export function reconcileStaleSessions(ctx: AppCtx, cutOff: SessionRow[] = []): SessionRow[] {
  const host = agentHost(ctx)
  const rows = ctx.db.select().from(sessions).all().map(rowToSession)

  const reconciled: SessionRow[] = []
  for (const session of rows) {
    if (host.isRunning(session.id)) continue
    if (hasThreadLog(session.id) && foldThread(readThreadEvents(session.id)).state !== 'idle') {
      appendThreadEvent(session.id, { type: 'process', state: 'stopped', restarted: true })
      cutOff.push(session)
    }
    if (session.status !== 'launching' && session.status !== 'live') continue
    markSessionEnded(ctx, session.id)
    emitForSession(ctx, session, {
      type: 'session.reconciled',
      message: `session marked ended at boot — the server restarted while it was ${session.status}`,
      data: {
        sessionId: session.id,
        previousStatus: session.status,
      },
    })
    reconciled.push(session)
  }
  return reconciled
}

/** What a chat a restart cut off mid-turn is told (agents-are-woken-only-when-it-matters decision 24). */
export const RESTART_CARRY_ON = '[runcastle] A server restart cut off your turn. Carry on where you were.'

/** The event a carry-on wake leaves on the chat's timeline. */
export const RESTART_CARRY_ON_EVENT = 'session.restart_carry_on'

/**
 * Whether a chat a restart cut off is told to carry on: a feature's lead
 * (its main chat, not a headless or self-planning run), an orchestrator chat,
 * or a worker still at work (burns-become-workers decision 10), whose row then
 * follows the turn. Side chats are not, nor a worker that landed, was dropped
 * or failed, nor a lead whose round was cut off (its round message already
 * goes), nor a lead of a feature that has shipped or been archived.
 */
function carriesOn(ctx: AppCtx, row: SessionRow): boolean {
  if (row.kind === 'project') return true
  if (row.kind === 'worker') {
    const status = getWorker(ctx, row.id)?.status
    return status === 'working' || status === 'queued'
  }
  if (row.kind !== 'chat' || !row.featureId || row.headless || row.purpose === 'self-plan') return false
  const feature = tryGetFeature(ctx, row.featureId)
  return !!feature && feature.status !== 'shipped' && feature.status !== 'archived'
}

/**
 * Wake each chat a restart cut off mid-turn, once, to carry on (decision 24).
 * Called once the server listens, since a woken agent reaches runcastle's MCP
 * server. On a copied database (a test drive) it starts no chat the drive has
 * not started. Best effort: nothing here throws.
 */
export async function wakeCutOffChats(ctx: AppCtx, cutOff: readonly SessionRow[]): Promise<void> {
  for (const row of cutOff) {
    try {
      if (!carriesOn(ctx, row) || !mayStartInBackground(row)) continue
      await agentHost(ctx).prompt(row.id, { text: RESTART_CARRY_ON }, { source: 'runcastle', display: { summary: 'A restart cut off this turn: carrying on' } })
      emitForSession(ctx, row, {
        type: RESTART_CARRY_ON_EVENT,
        message: 'told to carry on after a server restart cut off its turn',
        data: { sessionId: row.id },
      })
    } catch (err) {
      console.error('could not wake a chat the restart cut off', err)
    }
  }
}
