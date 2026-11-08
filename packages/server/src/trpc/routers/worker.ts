import type { WorkerRow } from '@runcastle/core'
import * as z from 'zod'
import { askWorkerToHandBack, listWorkers, queueHoldOf, startUnassignedWorker } from '../../workers/service'
import { workerPreviewPath } from '../../routes/design-pass-paths'
import { phoneDesignPort } from '../../services/phone-link'
import { publicProcedure, router } from '../context'

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
    .query(({ ctx, input }): (WorkerRow & { previewPath: string | null; passPort: number; heldBy: string | null })[] =>
      listWorkers(ctx, input.featureId).map((w) => ({
        ...w,
        previewPath: w.previewPort !== null && w.devServer ? workerPreviewPath(w.id) : null,
        passPort: phoneDesignPort(ctx.config),
        heldBy: queueHoldOf(ctx, w),
      })),
    ),

  /** The "+": a worker the human starts, with no assignment, that waits for them. */
  startUnassigned: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startUnassignedWorker(ctx, input.featureId)),

  /** Hand back: tell the worker to write its summary and hand back. */
  handBack: publicProcedure
    .input(z.object({ workerId: z.string() }))
    .mutation(({ ctx, input }) => askWorkerToHandBack(ctx, input.workerId)),
})
