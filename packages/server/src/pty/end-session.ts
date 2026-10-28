import type { AppCtx } from '../db/types'
import { getSessionRow, landProjectSession, markSessionEnded } from '../launcher/sessions'
import { stopDesignServerForSession } from '../services/design'
import { emitForSession } from '../services/events'
import { agentHost } from '../threads/types'

export interface EndSessionResult {
  sessionId: string
  ok: boolean
  /** Whether the thread's agent process was running and has been stopped. */
  killed: boolean
}

/**
 * End a thread (backs `feature.endSession`, and the archive, delete and
 * stop-run paths): stop its agent process if one runs, mark the row `ended`,
 * and drop a timeline event. Safe on a thread with no process — it still marks
 * the row ended idempotently. The thread's log and row stay; a later prompt
 * starts it again.
 */
export function endSession(
  ctx: AppCtx,
  sessionId: string,
  message = 'session ended by user',
): EndSessionResult {
  const host = agentHost(ctx)
  const killed = host.isRunning(sessionId)
  if (killed) void host.stop(sessionId, 'archived').catch((err) => console.error(`stopping thread ${sessionId} failed`, err))

  const session = markSessionEnded(ctx, sessionId)
  if (!session) return { sessionId, ok: !!getSessionRow(ctx, sessionId), killed }
  // A project session's commits live on `runcastle/project` until someone
  // moves them; ending it is that moment (decision 18). No-op for other kinds.
  landProjectSession(ctx, session)
  stopDesignServerForSession(ctx, session)
  emitForSession(ctx, session, {
    type: 'session.ended',
    message,
    data: { sessionId, killed },
  })
  return { sessionId, ok: true, killed }
}
