import type { AppCtx } from '../db/types'
import { getSessionRow, markSessionEnded } from '../launcher/sessions'
import { emit } from '../services/events'
import { ptyRegistry } from './registry'

export interface EndSessionResult {
  sessionId: string
  ok: boolean
  /** Whether a live PTY was found and killed (false for window-mode / already-ended). */
  killed: boolean
}

/**
 * End a session (UI-SPEC §5, backs `feature.endSession`): kill its PTY if one is
 * live, mark the session row `ended`, and drop a timeline event. Safe to call
 * for a session with no PTY (window mode, or one that already exited) — it still
 * marks the row ended idempotently.
 *
 * Killing the PTY fires the registry's `onExit`, which emits `session.pty_exited`
 * via the launcher hook; this function additionally emits `session.ended` so the
 * "ended by user" intent is visible on the timeline regardless of PTY presence.
 */
export function endSession(ctx: AppCtx, sessionId: string): EndSessionResult {
  const registry = ptyRegistry()
  const killed = registry.kill(sessionId)
  registry.remove(sessionId)

  const session = markSessionEnded(ctx, sessionId)
  if (session) {
    emit(ctx, session.featureId, {
      type: 'session.ended',
      message: 'session ended by user',
      data: { sessionId, killed },
    })
  } else {
    // No row (unknown id): still honour the kill, but there is nothing to mark.
    const existing = getSessionRow(ctx, sessionId)
    if (!existing) return { sessionId, ok: false, killed }
  }
  return { sessionId, ok: true, killed }
}
