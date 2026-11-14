import type { Need, WorkerRow } from '@runcastle/core'
import * as z from 'zod'
import type { AppCtx } from '../../db/types'
import { askWorkerToHandBack, listLiveWorkers, listProjectWorkers, listWorkers, locateWorker, queueHoldOf, startUnassignedWorker } from '../../workers/service'
import { workerPreviewPath } from '../../routes/design-pass-paths'
import { phoneDesignPort } from '../../services/phone-link'
import { publicProcedure, router } from '../context'
import { threadNeed } from '../../threads/read'
import { agentHost } from '../../threads/types'
import { getSessionRow } from '../../launcher/sessions'

/** A worker as the web lists it: its row, its preview's entry path and port, and any account hold it waits behind. */
type ListedWorker = WorkerRow & { previewPath: string | null; passPort: number; heldBy: string | null; need: Need | null; turnRunning: boolean }

function listed(ctx: AppCtx, w: WorkerRow): ListedWorker {
  return {
    ...w,
    previewPath: w.previewPort !== null && w.devServer ? workerPreviewPath(w.id) : null,
    passPort: phoneDesignPort(ctx.config),
    heldBy: queueHoldOf(ctx, w),
    need: threadNeed(ctx, w),
    // A worker `working` by status with no turn running reads Idle (needs-you decision 6).
    turnRunning: agentHost(ctx).isRunning(w.id) && getSessionRow(ctx, w.id)?.awaitingInput === false,
  }
}

/**
 * Interactive workers as the web drives them (docs/features/interactive-workers):
 * the feature's worker rows nested under its sidebar row, the project-wide live
 * list behind every feature's rows, the "+" that starts a worker
 * with no assignment (decision 7), and a worker's Hand back button (decision 5).
 * Thin over `workers/service.ts`, which owns the events.
 */
export const workerRouter = router({
  /**
   * The feature's workers, oldest first; the web groups them by status. Each
   * carries its preview's entry path on the design pass-through (decision 15),
   * which the web puts behind the listener's origin on `passPort`, and, for a
   * queued worker its runtime's account hold keeps from starting, why
   * (`heldBy`, burns-become-workers decision 21).
   */
  list: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }): ListedWorker[] => listWorkers(ctx, input.featureId).map((w) => listed(ctx, w))),

  /**
   * The project's own workers, owned by no feature: a project drive's Scenarios
   * worker, listed with the project's chats (drive-chats-become-workers decision 2).
   */
  listProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }): ListedWorker[] => listProjectWorkers(ctx, input.projectId).map((w) => listed(ctx, w))),

  /**
   * Every feature's live workers in the project — not handed back, landed or
   * dropped — oldest first, each carrying its `featureId`: the rows the sidebar
   * nests under each feature (workers-nest-under-their-feature decision 2).
   */
  listLive: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }): ListedWorker[] => listLiveWorkers(ctx, input.projectId).map((w) => listed(ctx, w))),

  /**
   * A worker's feature (id and slug), so a `worker:<id>` link in a chat can
   * open its chat (chats-link-to-what-they-name). Null for an unknown id, a
   * worker owned by no feature, and a worker of another project.
   */
  locate: publicProcedure
    .input(z.object({ projectId: z.string(), workerId: z.string() }))
    .query(({ ctx, input }) => locateWorker(ctx, input.projectId, input.workerId)),

  /** The "+": a worker the human starts, with no assignment, that waits for them. */
  startUnassigned: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startUnassignedWorker(ctx, input.featureId)),

  /** Hand back: tell the worker to write its summary and hand back. */
  handBack: publicProcedure
    .input(z.object({ workerId: z.string() }))
    .mutation(({ ctx, input }) => askWorkerToHandBack(ctx, input.workerId)),
})
