import type { SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { markSessionLive } from '../launcher/sessions'
import { startDocsWatch } from '../services/docs-watch'
import { emitForSession } from '../services/events'
import { tryGetFeature } from '../services/repo'
import { agentHost } from './types'

/**
 * A session whose row says `ended` while the agent host runs its process is
 * alive (the-orchestrator-is-never-locked-out decision 2): its row goes back to
 * `live`, and the timeline says why. The host owns whether a session is over
 * (decision 1), so a row it does not run stays ended: that is a killed
 * process's late turn, or a leftover agent, and neither may undo a stop.
 *
 * Returns the revived row, or null when there was nothing to revive.
 */
export function reviveIfRunning(
  ctx: AppCtx,
  session: SessionRow,
  by: 'turn' | 'tool call',
  ids: { ccSessionId?: string; transcriptPath?: string } = {},
): SessionRow | null {
  if (session.status !== 'ended' || !agentHost(ctx).isRunning(session.id)) return null
  const row = markSessionLive(ctx, session.id, ids)
  if (!row) return null
  // The end that marked it stopped the docs watch; a running conversation is watched again.
  if (row.featureId && (row.kind === 'chat' || row.kind === 'side')) {
    const feature = tryGetFeature(ctx, row.featureId)
    if (feature) startDocsWatch(ctx, feature)
  }
  emitForSession(ctx, row, {
    type: 'session.started',
    message: `session live again (a ${by} came from the process runcastle runs, though its record said ended)`,
    data: { sessionId: row.id, ccSessionId: row.ccSessionId ?? null, transcriptPath: row.transcriptPath ?? null, source: 'revived' },
  })
  return row
}
