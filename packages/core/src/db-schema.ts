import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AgentRuntime } from './config'
import type {
  FeatureStatus,
  FindingKind,
  FindingOpenReason,
  FindingResolvedBy,
  FindingSeverity,
  FindingStatus,
  FindingSource,
  MergeBranchPair,
  RunStatus,
  SessionKind,
  SessionPurpose,
  SessionStatus,
  TestNoteAuthor,
  TestNoteStatus,
  ProjectNoteStatus,
  ReviewVerify,
  ReviewWorkerMode,
  TicketKind,
  TicketStatus,
  WorkerEngine,
  WorkerKind,
  WorkerOutcome,
  WorkerStartedBy,
  WorkerStatus,
} from './schemas'
import type { ReviewGateRun } from './review-gates'
import type { TokenBreakdown } from './usage'

/**
 * Drizzle SQLite tables mirroring the zod schemas. JSON columns use
 * `text(..., { mode: 'json' })`. The server (`packages/server/src/db`) wires
 * these into a `drizzle-orm/bun-sqlite` client; core only declares shapes.
 */

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoPath: text('repo_path').notNull(),
  // Where the PROJECT SESSION's work lands (charter, ADRs) — human-owned and
  // null until somebody explicitly picks. Resolution is stored-else-detected at
  // use, so a zero-config project needs no setup click; detection never writes
  // here, which is the whole point: the stored default this replaced was
  // re-detected at every project open, so a corrected value could not stick.
  sessionBranch: text('session_branch'),
  devCommand: text('dev_command'),
  // Per-project settings overrides (issue #46): nullable columns holding a
  // project's override of the global default. `null` means "inherit the global"
  // (config file / env / schema default); resolution is `project ?? global`.
  // Additive + nullable so the migration leaves existing projects inheriting.
  model: text('model'),
  sandbox: text('sandbox'),
  // The container image this project's burns and sessions run in. A project
  // column rather than the global config alone because the toolchain a repo
  // needs — a JDK, a Python, a Go — is a fact about that repo, and a machine
  // -wide image cannot be right for two projects at once. Null inherits, and
  // resolution runs through `resolveSandboxImage` for every consumer.
  sandboxImage: text('sandbox_image'),
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
  // How to EXERCISE this app once it is up — the sample project to drive, how to
  // reach a deep state, what a driver may change inside the running app. Free
  // text, injected verbatim into every drive-mode review prompt. Project-only
  // for the same reason as `dbResetCommand`: a machine-wide default could only
  // ever describe some other repo's app.
  driveInstructions: text('drive_instructions'),
  // Test-drive hooks: opaque shell commands run before the dev pane starts and
  // after it stops. runcastle never parses them and holds no model of what a
  // "database" or a "service" is — bringing an environment up is exactly the
  // part that differs per stack (Postgres, SQLite, MySQL, Mongo, hosted, none),
  // so the only honest generic answer is to run the project's own string.
  driveSetupCommand: text('drive_setup_command'),
  driveStopCommand: text('drive_stop_command'),
  // Drive scenarios: one command with a `{file}` placeholder that runs a file
  // under `.runcastle/scenarios/` inside a drive. Project-only and opaque, like
  // the drive hooks; recorded by hand or by the scenario session, never by
  // `prepare` (so no provenance row).
  scenarioRunner: text('scenario_runner'),
  // Subject prefix for commits authored by runcastle's docs machinery. Null
  // uses the product default; burn-agent ticket subjects stay unchanged.
  docsCommitPrefix: text('docs_commit_prefix'),
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
  branch: text('branch').notNull(),
  /**
   * The branch `branch` was created from (issue: choosable base), and the only
   * source for the branch it merges back into. Null on a parked draft, which has
   * cut nothing and picks its base at Start; rows predating the column were
   * back-filled from the project-level default they in fact had.
   */
  baseBranch: text('base_branch'),
  status: text('status').notNull().$type<FeatureStatus>(),
  createdAt: integer('created_at').notNull(),
  /**
   * The up-next mark (`waiting-is-not-backlog` decision 1): "start by itself when
   * what I wait on ships". Meaningful only while `status = 'draft'`; starting
   * clears it. Not `waitingReason`, which is the lead waiting on the human.
   * Every feature created before the column stays in the backlog (decision 9).
   */
  upNext: integer('up_next', { mode: 'boolean' }).notNull().default(false),
  /**
   * The project thread (a session id) that holds this feature
   * (`threads-hold-features` decision 1): the one thread that hears its news and
   * may act on it. Null means no thread does, and the feature stays the human's.
   */
  heldBy: text('held_by'),
  /**
   * The feature's chat (`every-feature-has-one-owner` decision 21): the
   * orchestrator thread it came from, replaced when the human gives it to
   * another chat, moved with holds to a replacement chat. Null for a feature
   * made with New feature. Unlike `heldBy` it stays when the human takes the
   * feature: the lead's handback goes there, and the owner control offers to
   * give the feature back to it.
   */
  chatId: text('chat_id'),
  /**
   * How far its chat takes the feature (decision 7): `you` the human finishes
   * it, `show` the chat builds it and shows the human before merging, `merge`
   * the chat builds and merges it. On a human-owned feature with a chat's
   * choice, the chat takes it at the plan's yes (decision 14).
   */
  finish: text('finish', { enum: ['you', 'show', 'merge'] }).notNull().default('you'),
  /**
   * When the human pressed Stop (`the-feature-lead-runs-rounds` decision 23);
   * null when not stopped. Dispatch is refused while it is set and no human
   * message has arrived since; that message clears it.
   */
  stoppedAt: integer('stopped_at'),
  /**
   * Why nothing moves until the human acts — the status line's "Waiting for
   * you · <why>". Cleared by the next human message or round dispatch.
   */
  waitingReason: text('waiting_reason'),
  /**
   * Which kind of wait `waitingReason` is (`WaitingKind`: answer, plan, design,
   * stuck); set and cleared with it. Null with a reason reads as an answer.
   */
  waitingKind: text('waiting_kind', { enum: ['answer', 'plan', 'design', 'stuck'] }),
  /** When a human message last reached the lead (ms) — the after-Stop dispatch check. */
  lastHumanMessageAt: integer('last_human_message_at'),
  /** When the lead last dispatched a round (ms). */
  lastDispatchAt: integer('last_dispatch_at'),
  /** When the lead last showed the plan (`show_plan`, ms); null until it has. */
  planShownAt: integer('plan_shown_at'),
  /** When the human last opened the plan (ms): new to them while older than `planShownAt`. */
  planSeenAt: integer('plan_seen_at'),
  /**
   * The lead's outstanding handback to its orchestrator
   * (`the-status-tells-the-truth-about-who-and-what` decisions 5, 7): when it
   * handed back (ms) and its summary. Set by `hand_back`, replaced by a newer
   * one, and cleared by an orchestrator action on the feature, a human message
   * to the lead, or the hold moving. Both null when none is outstanding.
   */
  handbackAt: integer('handback_at'),
  handbackSummary: text('handback_summary'),
})

/**
 * A feature's designs (designs-and-the-plan-get-their-own-place decisions 1,
 * 8, 10, 18): one row per page on its design server, recorded by the agent's
 * `show_design`. Showing a page again updates its row and sets it back to
 * waiting. `picture` is the absolute path of runcastle's own copy.
 */
export const designs = sqliteTable(
  'designs',
  {
    id: text('id').primaryKey(),
    featureId: text('feature_id').notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    width: integer('width'),
    picture: text('picture'),
    state: text('state', { enum: ['waiting', 'approved', 'dropped'] }).notNull(),
    approvedBy: text('approved_by', { enum: ['human', 'lead'] }),
    shownAt: integer('shown_at').notNull(),
    /** When the human last opened it; null until they have. */
    seenAt: integer('seen_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('designs_feature_path').on(t.featureId, t.path)],
)

/**
 * The lead's "Ready for you" declarations (decision 9): each one put a drive in
 * front of the human, with the scenario to drive. `runId` is the round it
 * follows, null when no round had run yet.
 */
export const readyDeclarations = sqliteTable('ready_declarations', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  runId: text('run_id'),
  scenario: text('scenario').notNull(),
  createdAt: integer('created_at').notNull(),
})

/**
 * Merge-order dependencies between features (ADR-0013): the dependent (a draft)
 * cannot Start until every dependency's status is `shipped`. Satisfaction is
 * derived at read time — nothing about it is stored. One edge type with one job,
 * so there is deliberately NO `kind` column: a second edge type needs a new ADR,
 * not an enum value.
 */
export const featureDependencies = sqliteTable(
  'feature_dependencies',
  {
    dependentId: text('dependent_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    dependencyId: text('dependency_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.dependentId, t.dependencyId] })],
)

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  /**
   * Null for PROJECT-scoped sessions (`kind = 'project'` — see
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
   * and a `project` session has no feature to derive one from. Readers that
   * only have a session row — boot reconciliation, the hook receiver, the PTY
   * teardown — need it available without a lookup they cannot perform.
   *
   * Deliberately NOT backfilled onto existing feature sessions. Doing so would
   * mean a migration that joins `features` and hard-fails on boot for any
   * session whose feature is already gone; the feature path needs no such
   * column, so the asymmetry buys a migration that cannot fail.
   */
  projectId: text('project_id'),
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
  /**
   * The session runs with no terminal (a `self-plan`, `relay` or headless
   * start-lap run), so the page, the chat refusal and the exit handling key on
   * this rather than on one purpose. Every session before the column had a
   * terminal or was a `self-plan` run, whose purpose still says it.
   */
  headless: integer('headless', { mode: 'boolean' }).notNull().default(false),
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
   * later as fact. Readers treat a null `runtime` as `DEFAULT_RUNTIME`
   * (config.ts), which is what every historical session in fact ran on.
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
  /**
   * When the session was marked `ended`. Null while it is still `launching` or
   * `live`, and null forever on the rows that ended before this column existed
   * — their ending was never recorded, and `created_at` is not a stand-in for
   * it: a two-hour conversation closed a minute ago would read as two hours
   * old. Readers say "ended" with no age rather than fabricate one.
   *
   * Stamped once, by `markSessionEnded`; the end paths that funnel through it
   * (PTY exit, the Stop hook, boot reconciliation) can each fire on an
   * already-ended row, and the FIRST ending is the true one.
   */
  endedAt: integer('ended_at'),
  /** Tokens summed over this session's transcript (decision 3); null until counted. */
  tokens: integer('tokens'),
  /** The per-kind split behind `tokens` (input, output, cache…), as JSON; null until counted. */
  tokenBreakdown: text('token_breakdown', { mode: 'json' }).$type<TokenBreakdown>(),
  /**
   * The main-chat (`kind = 'chat'`) row a `side` session was opened beside —
   * the feature's newest chat row at open time. Null on every other kind, and on
   * a side session opened before the feature had any chat. Additive + nullable,
   * so the migration cannot fail.
   */
  openedBeside: text('opened_beside'),
})

/**
 * Interactive workers (docs/features/interactive-workers): one row per worker,
 * keyed by its thread's session id (`kind = 'worker'`). Mirrors `WorkerRow`.
 */
export const workers = sqliteTable(
  'workers',
  {
    id: text('id').primaryKey(),
    /** Null for a project-owned worker (a project drive's Scenarios worker). */
    featureId: text('feature_id'),
    projectId: text('project_id').notNull(),
    label: text('label').notNull(),
    purpose: text('purpose').notNull(),
    kind: text('kind').notNull().$type<WorkerKind>(),
    goal: text('goal'),
    doneWhen: text('done_when'),
    model: text('model').notNull(),
    runtime: text('runtime').notNull().$type<AgentRuntime>(),
    startedBy: text('started_by').notNull().$type<WorkerStartedBy>(),
    status: text('status').notNull().$type<WorkerStatus>(),
    failure: text('failure'),
    engine: text('engine').notNull().$type<WorkerEngine>(),
    container: text('container'),
    branch: text('branch'),
    featureBranch: text('feature_branch').notNull(),
    previewPort: integer('preview_port'),
    devServer: integer('dev_server', { mode: 'boolean' }).notNull().default(false),
    handbackSummary: text('handback_summary'),
    handbackCommits: text('handback_commits', { mode: 'json' }).$type<string[]>(),
    handbackFiles: text('handback_files', { mode: 'json' }).$type<string[]>(),
    outcome: text('outcome').$type<WorkerOutcome>(),
    outcomeNote: text('outcome_note'),
    /** Tokens the worker spent, summed over its kept conversation file when it was retired; null until counted. */
    tokens: integer('tokens'),
    /** A Review worker's mode, fixed at its start; null for every other kind. */
    reviewMode: text('review_mode').$type<ReviewWorkerMode>(),
    /** A verify review's findings and fix commits; null otherwise. */
    reviewVerify: text('review_verify', { mode: 'json' }).$type<ReviewVerify>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('workers_feature').on(t.featureId), index('workers_project').on(t.projectId)],
)

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
  passKind: text('pass_kind').notNull().$type<'review' | 'verification'>().default('review'),
  reviewedCommit: text('reviewed_commit'),
  reviewMode: text('review_mode').$type<'drive' | 'gates'>(),
  reviewVerdict: text('review_verdict').$type<'verified' | 'unverified'>(),
  reviewVerdictReason: text('review_verdict_reason'),
  /** The server's gate run for this review pass (`ReviewGateRun`); null until recorded. */
  reviewGateRun: text('review_gate_run', { mode: 'json' }).$type<ReviewGateRun>(),
  completedAt: integer('completed_at'),
  /**
   * The model this ticket burns on, or null for "resolve it the ordinary way"
   * (decisions.md #4). Nullable and additive: every ticket written before
   * per-ticket assignment existed reads back unassigned, which is exactly the
   * default chain it burned on.
   */
  model: text('model'),
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
  originFindingId: text('origin_finding_id'),
  /** Tokens the worker spent on this ticket, summed over its transcript; null until counted. */
  tokens: integer('tokens'),
  /** The per-kind split behind `tokens`, as JSON; null until counted. */
  tokenBreakdown: text('token_breakdown', { mode: 'json' }).$type<TokenBreakdown>(),
})

export const reviewFindings = sqliteTable('review_findings', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  /** The review ticket that reported it; null for a finding a Review worker reported. */
  reviewTicketId: text('review_ticket_id'),
  /** The Review worker that reported it (burns-become-workers decision 4); null on a finding from a review ticket. */
  reviewWorkerId: text('review_worker_id'),
  kind: text('kind').notNull().$type<FindingKind>(),
  severity: text('severity').notNull().$type<FindingSeverity>(),
  title: text('title').notNull(),
  location: text('location').notNull(),
  citation: text('citation').notNull(),
  detail: text('detail').notNull(),
  reproStep: text('repro_step').notNull(),
  status: text('status').notNull().$type<FindingStatus>(),
  openReason: text('open_reason').$type<FindingOpenReason>(),
  failureReason: text('failure_reason'),
  fixTicketId: text('fix_ticket_id'),
  resolvedBy: text('resolved_by').$type<FindingResolvedBy>(),
  resolutionNote: text('resolution_note'),
  createdAt: integer('created_at').notNull(),
})

export const testNotes = sqliteTable('test_notes', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull(),
  text: text('text').notNull(),
  status: text('status').notNull().$type<TestNoteStatus>(),
  /**
   * Who wrote the note — `human` or `agent`. Defaulted in the column too, so
   * rows written before review agents existed read back as the human's.
   */
  author: text('author').notNull().$type<TestNoteAuthor>().default('human'),
  /** The ticket a note was once promoted into; null on every note written since promotion went. */
  ticketId: text('ticket_id'),
  reviewTicketId: text('review_ticket_id'),
  /**
   * Seconds into the review walkthrough the note was captured at, when it was
   * captured from the annotation player; null for every note typed into the
   * plain input. `real` rather than `integer` so a sub-second scrub position
   * survives the round trip — the human pauses on a frame, not on a second.
   *
   * There is deliberately no record of WHICH walkthrough (decisions.md #7): the
   * annotated frame is baked into the screenshot, so a timestamp going stale
   * against a re-recorded video costs nothing.
   */
  videoTimestamp: real('video_timestamp'),
  /** When "Send to agent" delivered this note to the lead; null while unsent. */
  sentAt: integer('sent_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const projectNotes = sqliteTable('project_notes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  text: text('text').notNull(),
  status: text('status').notNull().$type<ProjectNoteStatus>(),
  outcome: text('outcome'),
  featureId: text('feature_id'),
  /** Branch a project drive was driving when the note was taken; null off-drive. */
  driveBranch: text('drive_branch'),
  /** Short HEAD SHA at that drive's start, `+dirty` on a dirty tree. */
  driveCommit: text('drive_commit'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
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
  /**
   * The project's verify commands, run against the branch tip when this round
   * ended (decision 10); null until they ran, and on non-round workflows.
   */
  gates: text('gates', { mode: 'json' }).$type<ReviewGateRun>(),
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
    // The token count's launch-record lookup (honest-token-counts).
    index('events_type_idx').on(t.type),
  ],
)

/**
 * Phones that said yes to notifications (`agents-can-notify-your-phone`): one
 * row per browser push subscription. It belongs to the install, not to a
 * project, because a phone has one switch for everything on this runcastle.
 */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  /** The push service's address for this browser; it also names the subscription. */
  endpoint: text('endpoint').primaryKey(),
  /** The browser's public key and auth secret, which encrypt each message to it. */
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
})

/**
 * This install's signing keys for push services (VAPID), made once. They sit in
 * the database rather than a file so they move with the subscriptions they
 * signed for; a subscription stops working under any other key.
 */
export const pushKeys = sqliteTable('push_keys', {
  /** Always 1: there is one key pair per install. */
  id: integer('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
})
