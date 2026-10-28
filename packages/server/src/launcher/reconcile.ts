import { foldThread, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { emitForSession } from '../services/events'
import { rowToSession } from '../services/repo'
import { hasThreadLog } from '../threads/log'
import { agentHost, appendThreadEvent, readThreadEvents } from '../threads/types'
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
 */
export function reconcileStaleSessions(ctx: AppCtx): SessionRow[] {
  const host = agentHost(ctx)
  const rows = ctx.db.select().from(sessions).all().map(rowToSession)

  const reconciled: SessionRow[] = []
  for (const session of rows) {
    if (host.isRunning(session.id)) continue
    if (hasThreadLog(session.id) && foldThread(readThreadEvents(session.id)).state !== 'idle') {
      appendThreadEvent(session.id, { type: 'process', state: 'stopped', restarted: true })
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
