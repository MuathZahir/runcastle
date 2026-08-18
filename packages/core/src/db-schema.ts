import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AgentRuntime } from './config'
import type {
  FeatureStatus,
  FindingSource,
  MergeBranchPair,
  Phase,
  RunStatus,
  SessionKind,
  SessionPurpose,
  SessionStatus,
  TestNoteAuthor,
  TestNoteStatus,
  TicketKind,
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
  // Prepared repo facts (project preparation). These four mirror same-named
  // GLOBAL config fields, which is the bug preparation exists to fix: "which
  // tests are already red" and "how do I verify" are properties of a REPO, so a
  // machine-wide value is wrong the moment a second project is opened. The
  // preparation agent writes them here per project; `project ?? global` keeps
  // an operator's existing global value working until a project overrides it.
  // `dbResetCommand` is project-only (no global twin) — it exists to un-drift a
  // dev database after a test drive, which is per-repo by construction.
  setupCommand: text('setup_command'),
  verifyCommands: text('verify_commands'),
  knownFailures: text('known_failures'),
  dbResetCommand: text('db_reset_command'),
  // Test-drive hooks: opaque shell commands run before the dev pane starts and
  // after it stops. runcastle never parses them and holds no model of what a
  // "database" or a "service" is — bringing an environment up is exactly the
  // part that differs per stack (Postgres, SQLite, MySQL, Mongo, hosted, none),
  // so the only honest generic answer is to run the project's own string.
  driveSetupCommand: text('drive_setup_command'),
  driveStopCommand: text('drive_stop_command'),
})

/**
 * Provenance for one prepared field (see {@link projects}). The VALUE lives in
 * the project column so every existing reader resolves it unchanged; this table
 * only records where it came from and what justified it.
 *
 * `source` is the whole point: a human-entered value is never overwritten by a
 * later preparation run, and the UI can say "you set this" vs "prep found
 * this". `establishedSha` pins the finding to the main-branch commit it was
 * measured at, so staleness is computable (`git rev-list <sha>..<main>`) rather
 * than guessed — a two-month-old test baseline is worse than none, because an
 * agent trusts it and misattributes its own breakage to the repo's.
 */
export const projectFindings = sqliteTable(
  'project_findings',
  {
    projectId: text('project_id').notNull(),
    /** The prepared field this describes (a `PreparedKey`). */
    key: text('key').notNull(),
    source: text('source').notNull().$type<FindingSource>(),
    /** What justified the value — the command output prep actually observed. */
    evidence: text('evidence'),
    establishedAt: integer('established_at').notNull(),
    /** Main-branch sha the finding was measured at; null for human entries. */
    establishedSha: text('established_sha'),
    /**
     * When a preparation dry run last observed this exact value working, and at
     * which commit. Null until a clean dry-run pass stamps it, and nulled again
     * by any write to the key (see `markVerified` / `recordFinding`).
     */
    verifiedAt: integer('verified_at'),
    verifiedSha: text('verified_sha'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })],
)

export const features = sqliteTable('features', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  oneLiner: text('one_liner').notNull(),
  /**
   * The brief a draft was parked with (decision 4) — a draft is a DB row and
   * nothing else, so its prose lives here until Start scaffolds `brief.md` from
   * it. Null for every feature not created as a draft.
   */
  brief: text('brief'),
  mapped: integer('mapped', { mode: 'boolean' }).notNull().default(false),
  /**
   * The lap the feature is on (ADR-0010 / SPEC §15.1) — one trip round the
   * pipeline. Rethink increments it; Fix does not. Every feature ever created
   * before laps existed was, by definition, on lap 1, which is what the default
   * backfills.
   */
  lap: integer('lap').notNull().default(1),
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
  /**
   * Null for PROJECT-scoped sessions (`kind = 'prepare'` or `'project'` — see
   * `PROJECT_SESSION_KINDS`), which exist before any feature does. Every other
   * kind carries its feature.
   *
   * Nullable rather than a parallel table: the PTY registry, hook receiver,
   * boot reconciliation, `ccSessionId` resume and `sessionDir` are all entirely
   * feature-agnostic, so a parallel table would duplicate the big half of the
   * machinery to avoid the small one.
   *
   * Safe by construction for every reader that FILTERS on this column — a NULL
   * never matches `eq(sessions.featureId, x)`, so project sessions are
   * invisible to the one-live-session-per-feature guard, to feature deletion
   * cascades and to per-feature listings, which is what we want in all three
   * cases. Readers that DEREFERENCE it are the ones that had to change; see
   * `emitForSession`.
   */
  featureId: text('feature_id'),
  /**
   * The project a PROJECT-scoped session belongs to. Null on feature sessions,
   * which derive their project through `feature_id` exactly as before.
   *
   * Events require a project id (`events.project_id` is NOT NULL — issue #44),
   * and a `prepare` session has no feature to derive one from. Readers that
   * only have a session row — boot reconciliation, the hook receiver, the PTY
   * teardown — need it available without a lookup they cannot perform.
   *
   * Deliberately NOT backfilled onto existing feature sessions. Doing so would
   * mean a migration that joins `features` and hard-fails on boot for any
   * session whose feature is already gone; the feature path needs no such
   * column, so the asymmetry buys a migration that cannot fail.
   */
  projectId: text('project_id'),
  /**
   * The feature's lap when this session was created (ADR-0010 / SPEC §15.1) — a
   * tag, not state: nothing reads it to make a decision, the lap trail groups on
   * it. A project-scoped `prepare` session has no feature to take a lap from and
   * stores 1.
   */
  lap: integer('lap').notNull().default(1),
  kind: text('kind').notNull().$type<SessionKind>(),
  /**
   * The errand this session was opened on, when `kind` cannot express it — null
   * for the ordinary launches, which is every session created before this
   * column existed. Additive + nullable, so the migration cannot fail.
   */
  purpose: text('purpose').$type<SessionPurpose>(),
  /**
   * The data that purpose needs: for `resolve-conflict`, the branch pair the
   * merge is between. Stored rather than re-derived because the session-end
   * probe runs long after the launch click that knew it.
   */
  purposeData: text('purpose_data', { mode: 'json' }).$type<MergeBranchPair>(),
  ccSessionId: text('cc_session_id'),
  transcriptPath: text('transcript_path'),
  status: text('status').notNull().$type<SessionStatus>(),
  /**
   * Where this session is in its TURN, as opposed to its lifecycle: true once
   * the agent has finished a turn (`Stop` hook) and is waiting on the human,
   * false while a submitted prompt is being worked on (`UserPromptSubmit`).
   *
   * `status` cannot answer this — a `live` session is live whether the agent is
   * mid-thought or has been idle for an hour — and the triage lanes need the
   * difference: it is what separates "Agent working" from "Needs you". A fresh
   * row is working, not waiting: nothing has stopped for anyone yet.
   */
  awaitingInput: integer('awaiting_input', { mode: 'boolean' }).notNull().default(false),
  worktreePath: text('worktree_path').notNull(),
  /**
   * The model this session was launched with, and the agent runtime that model
   * runs on — the pair `resolveModelEntry` yielded at launch, stamped here so
   * later readers never have to re-derive it from a config that has since moved
   * on.
   *
   * Both are nullable, and not only for the rows that predate the columns: a
   * session row created outside a launch (a fixture, a test) resolved no model,
   * and stamping the current default onto one would be a fabrication read back
   * later as fact. Readers treat a null `runtime` as {@link DEFAULT_RUNTIME},
   * which is what every historical session in fact ran on.
   */
  model: text('model'),
  runtime: text('runtime').$type<AgentRuntime>(),
  /**
   * This conversation's human-readable name, derived from the first thing the
   * human said in it and cached here (see `services/conversations.ts`). Null
   * until that derivation runs — the transcript does not exist at insert time,
   * and it is the transcript that knows what the conversation is about.
   *
   * Cached rather than derived per read because deriving it means opening a
   * JSONL transcript that grows for the whole session; a conversation list of
   * twenty rows would otherwise re-read twenty files on every poll.
   */
  title: text('title'),
  /**
   * When the row was inserted. Additive and nullable: `sessions` carried no
   * timestamp at all (readers ordered by the implicit `rowid`), and the rows
   * that predate this column have no creation time anyone can recover — a
   * backfilled default would be a fabricated date shown to the human as fact.
   */
  createdAt: integer('created_at'),
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
  /**
   * What the ticket asks for — `implementation` or `review`. Defaulted in the
   * column too, so rows written before the kind existed read back as
   * implementation tickets.
   */
  kind: text('kind').notNull().$type<TicketKind>().default('implementation'),
  /**
   * The feature's lap when this ticket was stored (ADR-0010 / SPEC §15.1).
   * Stamped server-side by `storeTickets` — sessions never choose it. G3 scopes
   * to the current lap's pending tickets; G4 stays cumulative.
   */
  lap: integer('lap').notNull().default(1),
  status: text('status').notNull().$type<TicketStatus>(),
  commits: text('commits', { mode: 'json' }).notNull().$type<string[]>(),
  error: text('error'),
  attemptBranch: text('attempt_branch'),
  conflictFiles: text('conflict_files', { mode: 'json' }).$type<string[]>(),
  /**
   * The burner's own account of what happened, harvested from the `DIGEST.md`
   * it writes just before signalling COMPLETE. Null whenever the agent wrote
   * none — harvest is best-effort and never blocks `done` (the burn emits a
   * `digest.missing` event instead).
   */
  digest: text('digest'),
})

export const testNotes = sqliteTable('test_notes', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  /**
   * The feature's lap when the note was captured (ADR-0010 / SPEC §15.1).
   * Stamped server-side by `addNote` — the human never chooses it — and it is
   * what groups the rendered `test-notes.md` into its `## Lap N` sections.
   */
  lap: integer('lap').notNull(),
  text: text('text').notNull(),
  status: text('status').notNull().$type<TestNoteStatus>(),
  /**
   * Who wrote the note — `human` or `agent`. Defaulted in the column too, so
   * rows written before review agents existed read back as the human's.
   */
  author: text('author').notNull().$type<TestNoteAuthor>().default('human'),
  /** The ticket a `promoted` note was turned into; null for every other status. */
  ticketId: text('ticket_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
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
  /** The run's harvested ticket digests, concatenated under per-ticket headers. */
  digest: text('digest'),
})

export const events = sqliteTable(
  'events',
  {
    // autoincrement integer — doubles as the polling cursor (`afterId`)
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Every event belongs to a project (issue #44). Feature-scoped events also
    // carry a `feature_id`; project-level events (open/close/rename) leave it null.
    projectId: text('project_id').notNull(),
    featureId: text('feature_id'),
    runId: text('run_id'),
    ticketId: text('ticket_id'),
    /**
     * The feature's lap when the event was appended (ADR-0010 / SPEC §15.1), so
     * the timeline can be grouped into laps without a join. Project-level events
     * have no feature to take a lap from and store 1.
     */
    lap: integer('lap').notNull().default(1),
    ts: integer('ts').notNull(),
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: text('data', { mode: 'json' }),
  },
  /**
   * The two cursor polls the UI runs every 1.5s — `listAfter` (feature timeline)
   * and `listByProject` (project timeline) — are both `WHERE <scope> = ? AND id
   * > ? ORDER BY id`. Each index covers its scope column and the cursor, so a
   * poll seeks straight to the cursor instead of scanning a table that only ever
   * grows: the events table is append-only and never pruned.
   */
  (t) => [
    index('events_project_id_id_idx').on(t.projectId, t.id),
    index('events_feature_id_id_idx').on(t.featureId, t.id),
  ],
)

export const gateOverrides = sqliteTable('gate_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  featureId: text('feature_id').notNull(),
  gate: text('gate').notNull(),
  reason: text('reason').notNull(),
  ts: integer('ts').notNull(),
})
