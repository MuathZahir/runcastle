import type { Feature, Project, Ticket } from './schemas'

/**
 * The workflow contract (CONTEXT.md decision #10, SPEC §1). Workflows
 * (ticket-burner, review, research-sweep) implement `WorkflowDef` and are
 * driven by the server's runner, which wires `WorkflowCtx` to live services.
 * Core only declares the contract — no implementation, no IO.
 */

export interface WorkflowCtx {
  project: Project
  feature: Feature
  tickets: Ticket[]
  emitEvent(e: {
    type: string
    message: string
    ticketId?: string
    data?: unknown
  }): void
  updateTicket(
    id: string,
    patch: Partial<Pick<Ticket, 'status' | 'commits' | 'error'>>,
  ): void
  signal: AbortSignal
}

export interface WorkflowDef {
  /** Stable identifier, e.g. `ticket-burner`. */
  id: string
  run(ctx: WorkflowCtx): Promise<{ status: 'succeeded' | 'failed'; summary: string }>
}
