import { DEFAULT_RUNTIME, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { chatKickoffHeader, kickoffFor } from '../launcher/launcher'
import { landProjectSession, setThreadPurpose } from '../launcher/sessions'
import { stopDesignServerForSession } from '../services/design'
import { startDocsWatch } from '../services/docs-watch'
import { emitForSession } from '../services/events'
import { getFeatureRow, tryGetFeature } from '../services/repo'
import { noteResolvedMerge } from '../services/resolved-merge'
import type { ThreadLifecycle } from './host'

/**
 * What the server does around a thread's process (chat-as-web-components;
 * ADR-0015) — the work a terminal's spawn and exit used to do, now hung on the
 * agent host:
 *
 * - a resumed main chat hears the feature's current state with the first
 *   prompt after its process starts (`one-chat-per-feature` decision 13);
 * - a thread whose conversation could not be loaded is briefed again, as a
 *   new conversation of its kind is;
 * - a feature conversation's docs are watched while it runs;
 * - a self-planning run says when its planning turn is over;
 * - a stopped project conversation lands its commits, as a closed terminal did.
 *
 * `session.process_started` / `session.process_stopped` put the process on the
 * timeline, where the orchestrator's notifier reads them.
 */
export function threadLifecycle(ctx: AppCtx): ThreadLifecycle {
  return {
    opening: (row) => resumeHeader(ctx, row),

    briefing: (row) => kickoffFor(ctx, row),

    started(row, source) {
      if (row.featureId && (row.kind === 'chat' || row.kind === 'side')) startDocsWatch(ctx, getFeatureRow(ctx, row.featureId))
      emitForSession(ctx, row, {
        type: 'session.process_started',
        message: `${row.kind} thread's agent started`,
        data: { sessionId: row.id, kind: row.kind, source },
      })
    },

    turnEnded(row, source) {
      // Only runcastle's prompt is the planning errand; what the human types into it after is a chat.
      if (source !== 'runcastle') return
      endSelfPlan(ctx, row)
    },

    stopped(row, reason, startedBy) {
      // A planning run stopped mid-turn (the human's Stop, a crash) is over too.
      endSelfPlan(ctx, row)
      // A project conversation's commits land on the base branch when it stops (decision 18).
      landProjectSession(ctx, row)
      // An idle stop is invisible to the human, so it leaves the design server they may be looking at.
      if (reason !== 'idle' || row.purpose === 'self-plan') stopDesignServerForSession(ctx, row)
      const feature = row.featureId ? tryGetFeature(ctx, row.featureId) : null
      if (feature && row.runtime === 'codex') void noteResolvedMerge(ctx, row, feature).catch(() => {})
      emitForSession(ctx, row, {
        type: 'session.process_stopped',
        message: `${row.kind} thread's agent stopped (${reason})`,
        data: { sessionId: row.id, kind: row.kind, reason, startedBy },
      })
    },
  }
}

/**
 * A self-planning run is over: say whether the plan is complete, and make the
 * thread the lead's ordinary chat again, so asks reach the human. No-op for a
 * thread with any other purpose.
 */
function endSelfPlan(ctx: AppCtx, row: SessionRow): void {
  if (row.purpose !== 'self-plan' || !row.featureId) return
  // The plan is complete when the run ended its turn asking the human for the yes (`wait_for_you`).
  const complete = getFeatureRow(ctx, row.featureId).waitingReason !== null
  emitForSession(ctx, row, {
    type: 'session.self_plan_ended',
    message: complete ? 'planning finished' : 'planning stopped before the plan was complete',
    data: { sessionId: row.id, complete },
  })
  setThreadPurpose(ctx, row.id, null)
}

/** The feature state a resumed main chat is handed with its first prompt; nothing for a new conversation. */
export function resumeHeader(ctx: AppCtx, row: SessionRow): string | undefined {
  if (row.kind !== 'chat' || !row.featureId || !row.ccSessionId) return undefined
  return chatKickoffHeader(ctx, getFeatureRow(ctx, row.featureId), row.runtime ?? DEFAULT_RUNTIME)
}
