import { foldThread, isDriveWorkerKind, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { mayStartInBackground } from '../services/database-copy'
import { emitForSession } from '../services/events'
import { truncatedFileList, uncommittedPaths } from '../services/git'
import { rowToSession, tryGetFeature } from '../services/repo'
import { endSelfPlan } from '../threads/lifecycle'
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

/** What a planning run a restart cut off is told (a-restart-resumes-planning-runs decision 1). */
export const RESTART_CARRY_ON_PLANNING = '[runcastle] A server restart cut off your planning run. Carry on where you were.'

/**
 * The planning run's wake message, naming the files it left uncommitted in its
 * worktree when it has any, so it carries on from them instead of starting
 * over (a-restart-resumes-planning-runs decision 2).
 */
export function planningCarryOn(files: readonly string[]): string {
  return files.length === 0 ? RESTART_CARRY_ON_PLANNING : `${RESTART_CARRY_ON_PLANNING}\nUncommitted in your folder: ${truncatedFileList(files)}`
}

/** The event a carry-on wake leaves on the chat's timeline. */
export const RESTART_CARRY_ON_EVENT = 'session.restart_carry_on'

/**
 * Whether a chat a restart cut off is told to carry on: a feature's lead
 * (its main chat, a planning run included — a-restart-resumes-planning-runs
 * decision 1 — but not a legacy headless run), an orchestrator chat,
 * or a worker still at work (burns-become-workers decision 10), whose row then
 * follows the turn. Side chats are not, nor a worker that landed, was dropped
 * or failed, nor a lead whose round was cut off (its round message already
 * goes), nor a lead of a feature that has shipped or been archived.
 */
function carriesOn(ctx: AppCtx, row: SessionRow): boolean {
  if (row.kind === 'project') return true
  if (row.kind === 'worker') {
    const w = getWorker(ctx, row.id)
    // A drive worker's drive died with the server: it is handed back at boot, not woken.
    if (!w || isDriveWorkerKind(w.kind)) return false
    return w.status === 'working' || w.status === 'queued'
  }
  if (row.kind !== 'chat' || !row.featureId || row.headless) return false
  const feature = tryGetFeature(ctx, row.featureId)
  return !!feature && feature.status !== 'shipped' && feature.status !== 'archived'
}

/**
 * Wake each chat a restart cut off mid-turn, once, to carry on (decision 24).
 * Called once the server listens, since a woken agent reaches runcastle's MCP
 * server. On a copied database (a test drive) it starts no chat the drive has
 * not started. Best effort: nothing here throws.
 *
 * A planning run is woken with its own message, sent as runcastle's so its
 * turn's end still closes the run as an uninterrupted one would. One that is
 * not woken is closed the way a Stop closes it, so its chat stops declining
 * questions (a-restart-resumes-planning-runs). On a test drive's copy every
 * cut-off chat began there (it has a thread log), so a planning run is woken
 * there as a lead is.
 */
export async function wakeCutOffChats(ctx: AppCtx, cutOff: readonly SessionRow[]): Promise<void> {
  for (const row of cutOff) {
    const planning = row.purpose === 'self-plan'
    let woken = false
    try {
      if (carriesOn(ctx, row) && mayStartInBackground(row)) {
        const text = planning ? planningCarryOn(await uncommittedPaths(row.worktreePath)) : RESTART_CARRY_ON
        const summary = planning ? 'A restart cut off planning: carrying on' : 'A restart cut off this turn: carrying on'
        await agentHost(ctx).prompt(row.id, { text }, { source: 'runcastle', display: { summary } })
        woken = true
        emitForSession(ctx, row, {
          type: RESTART_CARRY_ON_EVENT,
          message: 'told to carry on after a server restart cut off its turn',
          data: { sessionId: row.id },
        })
      }
    } catch (err) {
      console.error('could not wake a chat the restart cut off', err)
    }
    if (planning && !woken) {
      try {
        endSelfPlan(ctx, row)
      } catch (err) {
        console.error('could not close a planning run the restart cut off', err)
      }
    }
  }
}
