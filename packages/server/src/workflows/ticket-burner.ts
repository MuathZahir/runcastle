import type { WorkflowDef } from '@runcastle/core'
import { NotImplementedError } from '../errors'

/**
 * Ticket burner — WAVE B3 (SPEC §8), the AFK engine over `@ai-hero/sandcastle`.
 * Typed stub: the `WorkflowDef` shape (id + `run(ctx)`) is final so B3 replaces
 * only the body. Until then `run` throws `NotImplementedError('B3')`, which the
 * runner captures as a failed run (visible in the UI) rather than a crash.
 */
export const ticketBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(ctx) {
    void ctx
    throw new NotImplementedError('B3')
  },
}
