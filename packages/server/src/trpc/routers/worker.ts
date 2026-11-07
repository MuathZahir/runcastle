import type { WorkerRow } from '@runcastle/core'
import * as z from 'zod'
import { askWorkerToHandBack, listWorkers, startUnassignedWorker } from '../../workers/service'
import { publicProcedure, router } from '../context'

/**
 * Interactive workers as the web drives them (docs/features/interactive-workers):
 * the feature's worker rows for its sidebar page, the "+" that starts a worker
 * with no assignment (decision 7), and a worker's Hand back button (decision 5).
 * Thin over `workers/service.ts`, which owns the events.
 */
export const workerRouter = router({
  /** The feature's workers, oldest first; the web groups them by status. */
  list: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }): WorkerRow[] => listWorkers(ctx, input.featureId)),

  /** The "+": a worker the human starts, with no assignment, that waits for them. */
  startUnassigned: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startUnassignedWorker(ctx, input.featureId)),

  /** Hand back: tell the worker to write its summary and hand back. */
  handBack: publicProcedure
    .input(z.object({ workerId: z.string() }))
    .mutation(({ ctx, input }) => askWorkerToHandBack(ctx, input.workerId)),
})
