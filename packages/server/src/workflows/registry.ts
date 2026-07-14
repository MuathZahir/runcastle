import type { WorkflowDef } from '@runcastle/core'
import { ticketBurner } from './ticket-burner'

/**
 * The workflow registry (SPEC §3): a `Map<string, WorkflowDef>` the runner
 * resolves by id. M1 registers only `ticket-burner` (a wave-B3 stub for now);
 * loading workflows from `.sandcastle/` dirs or the runcastle registry is a
 * later additive change (CONTEXT.md decision #10).
 */
export const workflowRegistry = new Map<string, WorkflowDef>([
  [ticketBurner.id, ticketBurner],
])

export function getWorkflow(id: string): WorkflowDef | undefined {
  return workflowRegistry.get(id)
}
