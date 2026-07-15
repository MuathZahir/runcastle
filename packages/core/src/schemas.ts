import * as z from 'zod'

/**
 * Wire types for tRPC and MCP. Every schema here is the single source of
 * truth; drizzle tables (db-schema.ts) mirror these shapes.
 *
 * Timestamps are epoch milliseconds (numbers) so they serialise cleanly over
 * the wire and map to SQLite integer columns.
 */

// --- enums -----------------------------------------------------------------

export const Phase = z.enum([
  'ideation',
  'spec',
  'tickets',
  'implementation',
  'review',
  'shipped',
])
export type Phase = z.infer<typeof Phase>

/** `collapsed` = small feature; skips the `spec` phase. */
export const FeatureSize = z.enum(['full', 'collapsed'])
export type FeatureSize = z.infer<typeof FeatureSize>

export const TicketStatus = z.enum(['pending', 'burning', 'done', 'failed'])
export type TicketStatus = z.infer<typeof TicketStatus>

/**
 * `qa` = "come back and ask questions" — same injection, no phase writes.
 * Mapped ideation (ADR-0001 / SPEC §13.1) adds `waypoint` (work one frontier
 * waypoint) and `converge` (read map + decisions, then spec → tickets).
 */
export const SessionKind = z.enum(['ideation', 'qa', 'waypoint', 'converge'])
export type SessionKind = z.infer<typeof SessionKind>

export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatus>

export const FeatureStatus = z.enum(['active', 'shipped'])
export type FeatureStatus = z.infer<typeof FeatureStatus>

export const SessionStatus = z.enum(['launching', 'live', 'ended'])
export type SessionStatus = z.infer<typeof SessionStatus>

// --- tickets ---------------------------------------------------------------

/** What an ideation session emits via MCP `emit_tickets`. */
export const TicketInput = z.object({
  title: z.string(),
  goal: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
  seams: z.array(z.string()),
  /** seq numbers of other tickets in the same batch this one depends on */
  blockedBy: z.array(z.number()),
})
export type TicketInput = z.infer<typeof TicketInput>

/** A stored ticket: TicketInput plus persistence + run state. */
export const Ticket = TicketInput.extend({
  id: z.string(),
  featureId: z.string(),
  seq: z.number(),
  status: TicketStatus,
  commits: z.array(z.string()),
  error: z.string().optional(),
})
export type Ticket = z.infer<typeof Ticket>

// --- waypoints (mapped ideation, ADR-0001 / SPEC §13.1) --------------------

export const WaypointType = z.enum(['grilling', 'research', 'prototype', 'task'])
export type WaypointType = z.infer<typeof WaypointType>

export const WaypointStatus = z.enum(['open', 'claimed', 'resolved', 'dropped'])
export type WaypointStatus = z.infer<typeof WaypointStatus>

/** How a waypoint terminates: `resolved` (answered) or `dropped` (out of scope). */
export const WaypointDisposition = z.enum(['resolved', 'dropped'])
export type WaypointDisposition = z.infer<typeof WaypointDisposition>

/**
 * What any mapped session emits via MCP `emit_waypoints`. `blockedBy` mixes two
 * reference kinds resolved by `storeWaypoints`: 1-based positions within THIS
 * batch (numbers) and ids of already-stored waypoints (strings). Both resolve
 * to the referenced waypoints' global `seq` on store (mirroring tickets).
 */
export const WaypointInput = z.object({
  title: z.string(),
  type: WaypointType,
  question: z.string(),
  blockedBy: z.array(z.union([z.number(), z.string()])),
  /** The waypoint whose session surfaced this one (lineage; "surfaced by"). */
  originWaypointId: z.string().optional(),
})
export type WaypointInput = z.infer<typeof WaypointInput>

/**
 * A stored waypoint: WaypointInput plus persistence + lifecycle state.
 * `blockedBy` is narrowed to resolved global `seq` numbers. `claimedBy` holds
 * the claiming sessionId|runId while `claimed`; `lastSessionId` survives a
 * release so the UI can offer "Resume".
 */
export const Waypoint = WaypointInput.extend({
  id: z.string(),
  featureId: z.string(),
  seq: z.number(),
  blockedBy: z.array(z.number()),
  status: WaypointStatus,
  claimedBy: z.string().optional(),
  lastSessionId: z.string().optional(),
  summary: z.string().optional(),
})
export type Waypoint = z.infer<typeof Waypoint>

// --- core entities ---------------------------------------------------------

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  repoPath: z.string(),
  mainBranch: z.string(),
  devCommand: z.string().optional(),
})
export type Project = z.infer<typeof Project>

export const Feature = z.object({
  id: z.string(),
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  oneLiner: z.string(),
  size: FeatureSize,
  /**
   * Mapped ideation (ADR-0001 / SPEC §13): the feature's ideation phase runs as
   * a shared waypoint map instead of a single grill. Orthogonal to `size`; set
   * by the creation toggle or a mid-grill escalation. Defaults to false.
   */
  mapped: z.boolean(),
  phase: Phase,
  branch: z.string(),
  status: FeatureStatus,
  createdAt: z.number(),
})
export type Feature = z.infer<typeof Feature>

export const SessionRow = z.object({
  id: z.string(),
  featureId: z.string(),
  kind: SessionKind,
  ccSessionId: z.string().optional(),
  transcriptPath: z.string().optional(),
  status: SessionStatus,
  worktreePath: z.string(),
})
export type SessionRow = z.infer<typeof SessionRow>

export const Run = z.object({
  id: z.string(),
  featureId: z.string(),
  workflow: z.string(),
  status: RunStatus,
  startedAt: z.number(),
  endedAt: z.number().optional(),
  summary: z.string().optional(),
})
export type Run = z.infer<typeof Run>

/** `id` is an autoincrement integer — used as the polling cursor (`afterId`). */
export const EventRow = z.object({
  id: z.number(),
  featureId: z.string(),
  runId: z.string().optional(),
  ticketId: z.string().optional(),
  ts: z.number(),
  type: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
})
export type EventRow = z.infer<typeof EventRow>
