import type { SessionRow } from '@runcastle/core'
import { inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { sessions } from '../db/schema'
import { ptyRegistry } from '../pty/registry'
import { emit } from '../services/events'
import { rowToSession } from '../services/repo'
import { releaseForSession } from '../services/waypoints'
import { markSessionEnded } from './sessions'

/**
 * Boot reconciliation (E2E finding, severity 1). The PTY registry is in-memory,
 * so after a cold server start every `launching`/`live` session row is stale by
 * definition — its process (if it ever had one) died with the old server. Left
 * alone, those rows wedge the one-live-session guard forever and their claimed
 * waypoints never return to the frontier.
 *
 * For each stale session this mirrors the manual `endSession` path
 * (`pty/end-session.ts`) minus the PTY kill (there is nothing to kill) and with
 * an honest event type: mark the row `ended`, auto-release any waypoint it still
 * claims (`lastSessionId` is preserved so Resume keeps working), and emit ONE
 * `session.reconciled` event per session.
 *
 * `bun --hot` safety: the registry survives hot reloads on `globalThis`, so a
 * session whose PTY is genuinely still running is skipped — reconciliation only
 * ends sessions with no living process behind them.
 */
export function reconcileStaleSessions(ctx: AppCtx): SessionRow[] {
  const stale = ctx.db
    .select()
    .from(sessions)
    .where(inArray(sessions.status, ['launching', 'live']))
    .all()
    .map(rowToSession)

  const reconciled: SessionRow[] = []
  for (const session of stale) {
    const entry = ptyRegistry().get(session.id)
    if (entry && !entry.exited) continue // genuinely live across a hot reload

    markSessionEnded(ctx, session.id)
    const released = releaseForSession(ctx, session.id)
    emit(ctx, session.featureId, {
      type: 'session.reconciled',
      message: `session marked ended at boot — the server restarted while it was ${session.status}`,
      data: {
        sessionId: session.id,
        previousStatus: session.status,
        releasedWaypointIds: released.map((w) => w.id),
      },
    })
    reconciled.push(session)
  }
  return reconciled
}
