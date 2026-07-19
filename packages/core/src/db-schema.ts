import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  FeatureSize,
  FeatureStatus,
  Phase,
  RunStatus,
  SessionKind,
  SessionStatus,
  TicketStatus,
  WaypointStatus,
  WaypointType,
} from './schemas'

/**
 * Drizzle SQLite tables mirroring the zod schemas. JSON columns use
 * `text(..., { mode: 'json' })`. The server (`packages/server/src/db`) wires
 * these into a `drizzle-orm/bun-sqlite` client; core only declares shapes.
 */

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoPath: text('repo_path').notNull(),
  mainBranch: text('main_branch').notNull(),
  devCommand: text('dev_command'),
  // Per-project settings overrides (issue #46): nullable columns holding a
  // project's override of the global default. `null` means "inherit the global"
  // (config file / env / schema default); resolution is `project ?? global`.
  // Additive + nullable so the migration leaves existing projects inheriting.
  model: text('model'),
  sandbox: text('sandbox'),
  // Multi-project (issue #43): a project is "open" while `closedAt` is null.
  // `project.close` sets it (hiding the project); re-`open` clears it. Additive
  // and nullable so the migration leaves existing (open) projects untouched.
  closedAt: integer('closed_at'),
})

export const features = sqliteTable('features', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  oneLiner: text('one_liner').notNull(),
  size: text('size').notNull().$type<FeatureSize>(),
  mapped: integer('mapped', { mode: 'boolean' }).notNull().default(false),
  phase: text('phase').notNull().$type<Phase>(),
  branch: text('branch').notNull(),
  /**
   * The branch `branch` was created from (issue: choosable base). Null for
   * features created before this column existed — historically always the
   * project's `mainBranch`. New rows always store the resolved base explicitly.
   */
  baseBranch: text('base_branch'),
  status: text('status').notNull().$type<FeatureStatus>(),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  kind: text('kind').notNull().$type<SessionKind>(),
  ccSessionId: text('cc_session_id'),
  transcriptPath: text('transcript_path'),
  status: text('status').notNull().$type<SessionStatus>(),
  worktreePath: text('worktree_path').notNull(),
})

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  seq: integer('seq').notNull(),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  context: text('context').notNull(),
  acceptanceCriteria: text('acceptance_criteria', { mode: 'json' })
    .notNull()
    .$type<string[]>(),
  seams: text('seams', { mode: 'json' }).notNull().$type<string[]>(),
  blockedBy: text('blocked_by', { mode: 'json' }).notNull().$type<number[]>(),
  status: text('status').notNull().$type<TicketStatus>(),
  commits: text('commits', { mode: 'json' }).notNull().$type<string[]>(),
  error: text('error'),
})

export const waypoints = sqliteTable('waypoints', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  seq: integer('seq').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull().$type<WaypointType>(),
  question: text('question').notNull(),
  // resolved global seqs (numeric batch positions + existing-waypoint ids both
  // resolve to seq on store; see storeWaypoints)
  blockedBy: text('blocked_by', { mode: 'json' }).notNull().$type<number[]>(),
  originWaypointId: text('origin_waypoint_id'),
  status: text('status').notNull().$type<WaypointStatus>(),
  claimedBy: text('claimed_by'),
  lastSessionId: text('last_session_id'),
  summary: text('summary'),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  workflow: text('workflow').notNull(),
  status: text('status').notNull().$type<RunStatus>(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  summary: text('summary'),
})

export const events = sqliteTable('events', {
  // autoincrement integer — doubles as the polling cursor (`afterId`)
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Every event belongs to a project (issue #44). Feature-scoped events also
  // carry a `feature_id`; project-level events (open/close/rename) leave it null.
  projectId: text('project_id').notNull(),
  featureId: text('feature_id'),
  runId: text('run_id'),
  ticketId: text('ticket_id'),
  ts: integer('ts').notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  data: text('data', { mode: 'json' }),
})

export const gateOverrides = sqliteTable('gate_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  featureId: text('feature_id').notNull(),
  gate: text('gate').notNull(),
  reason: text('reason').notNull(),
  ts: integer('ts').notNull(),
})
