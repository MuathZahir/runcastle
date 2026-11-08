import type { WorkerRow } from '@runcastle/core'
import * as z from 'zod'
import type { AppCtx } from '../../db/types'
import { askWorkerToHandBack, listProjectWorkers, listWorkers, queueHoldOf, startUnassignedWorker } from '../../workers/service'
import { workerPreviewPath } from '../../routes/design-pass-paths'
import { phoneDesignPort } from '../../services/phone-link'
import { publicProcedure, router } from '../context'

/** A worker as the web lists it: its row, its preview's entry path and port, and any account hold it waits behind. */
type ListedWorker = WorkerRow & { previewPath: string | null; passPort: number; heldBy: string | null }

function listed(ctx: AppCtx, w: WorkerRow): ListedWorker {
  return {
    ...w,
    previewPath: w.previewPort !== null && w.devServer ? workerPreviewPath(w.id) : null,
    passPort: phoneDesignPort(ctx.config),
    heldBy: queueHoldOf(ctx, w),
  }
}

/**
 * Interactive workers as the web drives them (docs/features/interactive-workers):
 * the feature's worker rows for its sidebar page, the "+" that starts a worker
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

  /** The "+": a worker the human starts, with no assignment, that waits for them. */
  startUnassigned: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startUnassignedWorker(ctx, input.featureId)),

  /** Hand back: tell the worker to write its summary and hand back. */
  handBack: publicProcedure
    .input(z.object({ workerId: z.string() }))
    .mutation(({ ctx, input }) => askWorkerToHandBack(ctx, input.workerId)),
})
