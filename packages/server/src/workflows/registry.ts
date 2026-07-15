import type { WorkflowDef } from '@runcastle/core'
import { research } from './research'
import { ticketBurner } from './ticket-burner'

/**
 * The workflow registry (SPEC §3): a `Map<string, WorkflowDef>` the runner
 * resolves by id. Registers `ticket-burner` (SPEC §8) and `research` (mapped
 * ideation, SPEC §13.2 — the AFK research-waypoint engine). Loading workflows
 * from `.sandcastle/` dirs or the runcastle registry is a later additive change
 * (CONTEXT.md decision #10).
 */
export const workflowRegistry = new Map<string, WorkflowDef>([
  [ticketBurner.id, ticketBurner],
  [research.id, research],
])

export function getWorkflow(id: string): WorkflowDef | undefined {
  return workflowRegistry.get(id)
}
