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

/**
 * `cancelled` is a terminal state set by a human/agent (revisit sessions,
 * `cancel_ticket`) — never by the burner. The scheduler skips cancelled tickets
 * and treats a cancelled blocker as satisfied (the work was deemed unnecessary,
 * so dependents proceed).
 */
export const TicketStatus = z.enum(['pending', 'burning', 'done', 'failed', 'cancelled'])
export type TicketStatus = z.infer<typeof TicketStatus>

/**
 * `qa` = "come back and ask questions" — same injection, no phase writes.
 * Mapped ideation (ADR-0001 / SPEC §13.1) adds `waypoint` (work one frontier
 * waypoint) and `converge` (read map + decisions, then spec → tickets).
 * `revisit` = "I remembered something" — resumes the feature's most recent
 * resumable conversation to amend docs and do ticket surgery (edit/cancel/emit);
 * never advances phases.
 * `project` = the intake session (decisions 17–20 of feature-grouping): a
 * project-scoped conversation that turns raw intent into features. It has no
 * feature and no phase to advance.
 */
export const SessionKind = z.enum([
  'ideation',
  'qa',
  'waypoint',
  'converge',
  'revisit',
  'prepare',
  'project',
])
export type SessionKind = z.infer<typeof SessionKind>

/**
 * The PROJECT-scoped session kinds: neither has a feature, so their
 * `sessions.feature_id` is null (the only kinds for which that is true) and
 * `sessions.project_id` carries the scope instead.
 *
 * `project` is the intake session: it takes a lump of raw intent, grills it
 * until it resolves into N features, and creates them. It works in a
 * runcastle-owned worktree on `runcastle/project` and lands its commits on the
 * base branch — never in the human's checkout.
 *
 * It exists because a headless preparation run can measure a repo but cannot
 * ask a question. A real run established 7 of 8 keys and then declined the 8th
 * — it knew the variable name, wrote out what the value would look like, and
 * stopped, because supplying it meant inventing a bootstrap step the repo
 * documents nowhere. That is not a prompt problem; it needs a human. This kind
 * is the conversation that closes those gaps, and unlike the headless run it
 * executes on the HOST, so the five keys prep can only propose ("not executed —
 * host-only") can actually be run and verified.
 */
export const PROJECT_SESSION_KINDS = ['prepare', 'project'] as const

/** True for session kinds that belong to a project rather than a feature. */
export function isProjectSessionKind(kind: SessionKind): boolean {
  return (PROJECT_SESSION_KINDS as readonly string[]).includes(kind)
}

export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatus>

export const FeatureStatus = z.enum(['active', 'shipped', 'archived'])
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
  /**
   * The lap this ticket was emitted in (ADR-0010 / SPEC §15.1). Stamped from
   * `feature.lap` at store time — `TicketInput` deliberately has no `lap`,
   * because sessions never choose it.
   */
  lap: z.number(),
  commits: z.array(z.string()),
  error: z.string().optional(),
  /**
   * Tip of the last failed burn attempt's temp branch, when that attempt left
   * commits behind. The next burn of this ticket (auto-retry within a run, a
   * re-burn, or a manual per-ticket retry) bases its new attempt on this branch
   * so committed work is never redone; cleared when the ticket lands or the
   * user retries "fresh".
   */
  attemptBranch: z.string().optional(),
  /**
   * Repo-relative paths that conflicted when `attemptBranch` last failed to land
   * on the feature branch. Present (possibly empty, when git could not report
   * the paths) IFF the ticket's preserved work is blocked by a landing conflict
   * rather than by unfinished implementation — which is what makes the next burn
   * of this ticket run the conflict RESOLVER instead of the implementer, and
   * what the run lane renders its conflict card from. Cleared once the branch
   * lands or the user retries "fresh".
   */
  conflictFiles: z.array(z.string()).optional(),
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

/**
 * The repo facts a preparation run establishes, in the order the settings UI
 * and the prep prompt present them. Each maps 1:1 to a project column; the
 * first three also have a global config twin (`project ?? global`), while
 * `devCommand`, the two drive hooks and `dbResetCommand` are project-only.
 *
 * These are FINDINGS, not preferences: answering any of them honestly means
 * reading the repo's workspace layout and running its suite, which is why they
 * sit empty on almost every install. Preparation pays that cost once, with
 * evidence, instead of every burn agent re-deriving it per ticket (ADR-0008).
 */
export const PREPARED_KEYS = [
  'setupCommand',
  'verifyCommands',
  'knownFailures',
  'devCommand',
  'driveSetupCommand',
  'driveStopCommand',
  'driveEnv',
  'dbResetCommand',
] as const
export const PreparedKey = z.enum(PREPARED_KEYS)
export type PreparedKey = z.infer<typeof PreparedKey>

/**
 * Who established a prepared value. A `human` value is never auto-overwritten.
 *
 * `session` is the interactive-preparation source: an agent measured it on the
 * host while a human watched. It deliberately does NOT lock the key the way
 * `human` does — a later headless run may still improve it — but it stays
 * distinguishable in the UI from an unattended finding, because "I ran this on
 * your actual machine with you there" is a different claim from "I ran this in
 * a container". A value the human supplied or confirmed verbatim during that
 * same session is recorded as `human`, not `session`: the lock belongs to who
 * decided the value, not to which process wrote the row.
 */
export const FindingSource = z.enum(['prep', 'human', 'session'])
export type FindingSource = z.infer<typeof FindingSource>

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  repoPath: z.string(),
  mainBranch: z.string(),
  devCommand: z.string().optional(),
  /** Per-project default-model override (issue #48); unset → inherit global. */
  model: z.string().optional(),
  /** Prepared repo facts (see {@link PREPARED_KEYS}); unset → inherit global. */
  setupCommand: z.string().optional(),
  verifyCommands: z.string().optional(),
  knownFailures: z.string().optional(),
  dbResetCommand: z.string().optional(),
  /** Shell run before / after a test drive's dev pane; opaque to runcastle. */
  driveSetupCommand: z.string().optional(),
  driveStopCommand: z.string().optional(),
  /** `KEY=VALUE` lines overlaid on a drive's environment, `{{id}}`-templated. */
  driveEnv: z.string().optional(),
})
export type Project = z.infer<typeof Project>

/**
 * A prepared field's provenance, as the UI and the staleness check see it.
 * `staleCommits` is how far the repo's main branch has moved since the finding
 * was measured — `undefined` when it cannot be computed (no sha, or the sha is
 * no longer reachable after a rebase), which the UI shows as "unknown", never
 * as "fresh".
 */
export const ProjectFinding = z.object({
  key: PreparedKey,
  source: FindingSource,
  evidence: z.string().optional(),
  establishedAt: z.number(),
  establishedSha: z.string().optional(),
  staleCommits: z.number().optional(),
})
export type ProjectFinding = z.infer<typeof ProjectFinding>

export const PrepStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
export type PrepStatus = z.infer<typeof PrepStatus>

/** One preparation run over a project (project-scoped sibling of `Run`). */
export const PrepRun = z.object({
  id: z.string(),
  projectId: z.string(),
  status: PrepStatus,
  startedAt: z.number(),
  endedAt: z.number().optional(),
  summary: z.string().optional(),
  headSha: z.string().optional(),
})
export type PrepRun = z.infer<typeof PrepRun>

export const Feature = z.object({
  id: z.string(),
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  oneLiner: z.string(),
  /**
   * Mapped ideation (ADR-0001 / SPEC §13): the feature's ideation phase runs as
   * a shared waypoint map instead of a single grill. Set by a mid-grill
   * escalation. Defaults to false.
   */
  mapped: z.boolean(),
  /**
   * Which trip round the pipeline the feature is on (ADR-0010 / SPEC §15.1).
   * Starts at 1; Rethink increments it, Fix never does. Tickets, sessions and
   * events are stamped with it, and the lap trail is derived by grouping on
   * those stamps — there is no laps table.
   */
  lap: z.number(),
  phase: Phase,
  branch: z.string(),
  /**
   * The branch `branch` was forked from at creation (choosable base; defaults to
   * the project's `mainBranch`). Unset on features created before this existed.
   */
  baseBranch: z.string().optional(),
  status: FeatureStatus,
  createdAt: z.number(),
})
export type Feature = z.infer<typeof Feature>

export const SessionRow = z.object({
  id: z.string(),
  /** Absent on project-scoped sessions ({@link PROJECT_SESSION_KINDS}) — see the db schema. */
  featureId: z.string().optional(),
  /** Set on project-scoped sessions only; feature sessions derive it via the feature. */
  projectId: z.string().optional(),
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

// --- settings (issue #46) --------------------------------------------------

/**
 * Where a resolved setting's effective value comes from (SPEC §4, settings
 * router). Resolution order is `env` (always wins, locks the field) → `project`
 * (per-project override row) → `file` (machine `config.json`) → `default`
 * (schema default).
 */
export const SettingSource = z.enum(['env', 'project', 'file', 'default'])
export type SettingSource = z.infer<typeof SettingSource>

/** Where a `settings.update` for this field writes: the global config file or a project override. */
export const SettingScope = z.enum(['global', 'project'])
export type SettingScope = z.infer<typeof SettingScope>

/**
 * One resolved setting as returned by `settings.get`: its effective `value`,
 * the `source` it resolved from, whether it is `editable` (env-locked fields are
 * not), whether changing it needs a server `restartRequired` (e.g. serverPort),
 * and the `scope` a write would target.
 */
export const SettingField = z.object({
  key: z.string(),
  value: z.unknown(),
  source: SettingSource,
  editable: z.boolean(),
  restartRequired: z.boolean(),
  scope: SettingScope,
})
export type SettingField = z.infer<typeof SettingField>

/** `settings.get` output: the resolved field set, plus the project it was scoped to (if any). */
export const SettingsView = z.object({
  projectId: z.string().optional(),
  fields: z.array(SettingField),
})
export type SettingsView = z.infer<typeof SettingsView>

/**
 * `settings.update` input: set `projectId` to write a per-project override
 * (only for project-overridable fields), omit it to write the global default.
 * A `null` value clears a project override (falls back to the global).
 */
export const SettingsUpdateInput = z.object({
  projectId: z.string().optional(),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateInput>

/** `id` is an autoincrement integer — used as the polling cursor (`afterId`). */
export const EventRow = z.object({
  id: z.number(),
  projectId: z.string(),
  featureId: z.string().optional(),
  runId: z.string().optional(),
  ticketId: z.string().optional(),
  ts: z.number(),
  type: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
})
export type EventRow = z.infer<typeof EventRow>
