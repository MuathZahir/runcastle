import type { Feature, FixProgress, Project, ReviewFinding, Ticket, TicketInput } from './schemas'

/**
 * The workflow contract (CONTEXT.md decision #10, SPEC §1). Workflows
 * (ticket-burner, review, research-sweep) implement `WorkflowDef` and are
 * driven by the server's runner, which wires `WorkflowCtx` to live services.
 * Core only declares the contract — no implementation, no IO.
 */

export interface WorkflowCtx {
  /**
   * The run this workflow is executing as. Workflows that spawn an agent with
   * authority over the human's machine identify it by this id — the burner's
   * review ticket names it in the `X-Runcastle-Run` header of its `mcp.json`,
   * which is what the run-gated MCP tools resolve their feature from.
   */
  runId: string
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
    // `null` clears a stored error/attemptBranch/conflictFiles (retry +
    // successful-landing paths).
    patch: Partial<Pick<Ticket, 'status' | 'commits' | 'digest'>> & {
      error?: string | null
      attemptBranch?: string | null
      conflictFiles?: string[] | null
      reviewedCommit?: string | null
    },
  ): void
  /**
   * Re-read this feature's tickets from the store. `tickets` above is the set
   * the run opened with, and a review's findings mint their fix tickets WHILE
   * the run is live — so a scheduler that only ever sees the opening snapshot
   * leaves them pending for a human to burn by hand. Optional: a workflow that
   * never mints tickets mid-run needs it, and neither does a test fake.
   */
  listTickets?(): Ticket[]
  /** Store scheduler-created tickets through the same service as human/agent batches. */
  storeTickets?(inputs: TicketInput[]): Ticket[]
  /** Read findings when a verification ticket records the fixes it is checking. */
  listFindings?(): ReviewFinding[]
  /**
   * Mirror a fix ticket's lifecycle onto the review finding it was minted from
   * (`ticket.originFindingId`), so found/fixed/open is counted from findings
   * joined to their tickets rather than from two ledgers that can disagree.
   * `reason` is the ticket's error and belongs to `failed` alone.
   */
  updateFinding?(findingId: string, progress: FixProgress, reason?: string): void
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
  /**
   * `summary` is the run's one-liner (lists, timelines). `digest` is the
   * optional long-form account of what the run produced — the ticket-burner's
   * mechanical concatenation of the digests it harvested; workflows with
   * nothing to say omit it and the runner leaves the column null.
   */
  run(ctx: WorkflowCtx): Promise<{
    status: 'succeeded' | 'failed'
    summary: string
    digest?: string
  }>
}
