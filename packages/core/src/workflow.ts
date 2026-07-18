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
  /**
   * Per-run payload wired by the runner (SPEC §13.1). The research workflow reads
   * the `Waypoint` it was started on from here; the ticket-burner ignores it.
   */
  input?: unknown
  /**
   * Per-run model override (issue #48). When set, it wins the `resolveModel`
   * chain for this run's AFK agent (`runOverride`) — used by the scripted smoke
   * to force a cheap model without the retired `RUNCASTLE_MODEL` env hack.
   */
  modelOverride?: string
  /**
   * Resolve (or drop) the waypoint this run is working, flipping its lifecycle
   * status and recording a one-line summary (SPEC §13.1/§13.2). A run that never
   * calls this leaves its waypoint claimed; the runner's finalizer then
   * auto-releases it back to the frontier (failure/cancel path).
   */
  resolveWaypoint(id: string, disposition: 'resolved' | 'dropped', summary: string): void
  signal: AbortSignal
}

export interface WorkflowDef {
  /** Stable identifier, e.g. `ticket-burner`. */
  id: string
  run(ctx: WorkflowCtx): Promise<{ status: 'succeeded' | 'failed'; summary: string }>
}
