import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  Feature,
  FeatureStatus as FeatureStatusT,
  FindingSource as FindingSourceT,
  Phase as PhaseT,
  PreparedKey as PreparedKeyT,
  Project,
  RunStatus as RunStatusT,
  ModelEntry,
  SessionKind as SessionKindT,
  SessionRow,
  TestNote,
  Ticket,
  TicketInput as TicketInputT,
  TicketStatus as TicketStatusT,
  Waypoint as WaypointT,
  WaypointInput as WaypointInputT,
} from '@runcastle/core'
import {
  Phase,
  PreparedKey,
  TicketInput,
  WaypointDisposition,
  WaypointInput,
  isProjectSessionKind,
  modelRoster,
  nextGate,
  nextPhase,
} from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import { Hono } from 'hono'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError, isNotImplemented } from '../errors'
import { RUN_HEADER } from '../launcher/artifacts'
import { getRuntimeCtx } from '../launcher/runtime'
import { getSessionRow, mostRecentLiveSession } from '../launcher/sessions'
import {
  advance,
  createFeature,
  escalateToMap,
  list as listFeatures,
  quickChange,
} from '../services/features'
import { emit, emitForSession, emitProject, latestEventTs } from '../services/events'
import { isOverwritable, recordFinding } from '../services/findings'
import * as git from '../services/git'
import type { AdrDoc } from '../services/knowledge'
import { listDocs, listLiveAdrs, readCharter, readDoc } from '../services/knowledge'
import {
  getFeatureRow,
  getProjectById,
  listRunsByFeature,
  projectForFeature,
  tryGetRun,
} from '../services/repo'
import { addNote } from '../services/test-notes'
import {
  cancelTicket,
  editTicket,
  getTicket,
  listByFeature,
  storeTickets,
  type TicketContentPatch,
} from '../services/tickets'
import {
  claimedForFeature,
  frontier as waypointFrontier,
  listByFeature as listWaypoints,
  resolve as resolveWaypoint,
  storeWaypoints,
} from '../services/waypoints'

/**
 * runcastle MCP server (SPEC §6 + §13.3) — zod-validated tools over Streamable HTTP
 * (`@hono/mcp` + `@modelcontextprotocol/sdk` 1.29, per docs/research/STACK-NOTES §5).
 *
 * Session identity: the `X-Runcastle-Session` header set in each session's
 * `mcp.json` (forwarded by `@hono/mcp` as `requestInfo.headers`). Fallback: the
 * most recently created live session — acceptable in M1, where at most one live
 * ideation session exists at a time (see `mostRecentLiveSession`).
 *
 * A fresh `McpServer` + transport is built per request (stateless mode,
 * `enableJsonResponse`) so there is no cross-request shared transport state.
 */

// --- session resolution -----------------------------------------------------

interface HeaderCarrier {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> }
}

/**
 * One identity header off a request. Both spellings are read because
 * `@hono/mcp` forwards whatever the client sent, and a header map is not
 * guaranteed to be case-folded.
 */
function identityHeader(extra: HeaderCarrier, name: string): string | undefined {
  const headers = extra.requestInfo?.headers
  if (!headers) return undefined
  const raw = headers[name.toLowerCase()] ?? headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function headerSessionId(extra: HeaderCarrier): string | undefined {
  return identityHeader(extra, 'X-Runcastle-Session')
}

/** Resolve the session for a tool call: header first, else the live singleton. */
export function resolveSession(ctx: AppCtx, sessionId: string | undefined): SessionRow | null {
  if (sessionId) {
    const byId = getSessionRow(ctx, sessionId)
    if (byId) return byId
  }
  return mostRecentLiveSession(ctx)
}

/**
 * The feature a tool call belongs to, or a refusal that says why.
 *
 * Every tool below this line is feature-shaped — each one advances a feature
 * through a gate — and a project-scoped session has no feature. Guarding once
 * here rather than making each tool null-check means the failure is a legible
 * message the agent can act on instead of a crash inside `getFeatureRow` — and
 * it keeps the null impossible to forget when a tool is added later, because
 * the featureId simply isn't reachable without this call.
 *
 * The refusal names the session's OWN project-scoped tools, so an agent that
 * reached for the wrong half of the surface is pointed at the right half rather
 * than just told no (the kinds are few, and each has exactly one entry point).
 */
function requireFeatureId(session: SessionRow): string {
  if (!session.featureId) {
    const instead =
      session.kind === 'project'
        ? 'Your tools are create_feature, get_project_context, get_work_record and record_event — ' +
          'to work an existing feature, tell the human to open its terminal.'
        : 'Use record_finding to store what you establish about the project.'
    throw new GateError(
      `this tool belongs to a feature, and a ${session.kind} session is project-scoped. ${instead}`,
    )
  }
  return session.featureId
}

// --- tool implementations (pure over AppCtx + session — unit-tested) ---------

/** One annotated roster entry, as the tickets session is offered it. */
export interface AnnotatedModel {
  id: string
  runtime: ModelEntry['runtime']
  note: string
}

/**
 * The roster entries carrying a use-case note, in roster order. A blank note is
 * no note — the operator cleared the field rather than describing a use case.
 */
function annotatedModels(ctx: AppCtx): AnnotatedModel[] {
  return modelRoster(ctx.config).flatMap((m) =>
    m.note?.trim() ? [{ id: m.id, runtime: m.runtime, note: m.note.trim() }] : [],
  )
}

export interface FeatureContext {
  feature: ReturnType<typeof getFeatureRow>
  phase: PhaseT
  /**
   * The lap the feature is on (SPEC §15.3). `tickets` below is the full history
   * across every lap — the `lap` on each row is what distinguishes them.
   */
  lap: number
  docs: { relPath: string; content: string }[]
  tickets: Ticket[]
  /**
   * The models the operator annotated with a use-case note, and the only ones a
   * ticket may be assigned (decisions.md #4). Notes ARE the opt-in: an operator
   * who annotated nothing gets an empty array here, and the emitting session
   * then never assigns a model at all — today's behaviour, unchanged.
   */
  annotatedModels: AnnotatedModel[]
  /** Mapped features only (ADR-0001 §13.3): every waypoint on the map… */
  waypoints?: WaypointT[]
  /** …and the subset currently on the frontier (open, unclaimed, unblocked). */
  frontier?: WaypointT[]
  /** The waypoint THIS session claimed (kind=waypoint) — the one to work + resolve. */
  assignedWaypoint?: WaypointT
}

export function toolGetFeatureContext(ctx: AppCtx, session: SessionRow): FeatureContext {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  const docs = listDocs(ctx, feature).map((d) => {
    try {
      return { relPath: d.relPath, content: readDoc(ctx, feature, d.relPath).content }
    } catch {
      return { relPath: d.relPath, content: '' }
    }
  })
  const context: FeatureContext = {
    feature,
    phase: feature.phase,
    lap: feature.lap,
    docs,
    tickets: listByFeature(ctx, feature.id),
    annotatedModels: annotatedModels(ctx),
  }
  // A mapped feature also exposes its map state so any session can read the
  // waypoints and pick up the frontier (claiming stays a server-only effect).
  if (feature.mapped) {
    context.waypoints = listWaypoints(ctx, feature.id)
    context.frontier = waypointFrontier(ctx, feature.id)
    // A waypoint session works exactly the waypoint it claimed — surface it so
    // the entry skill knows its assignment without guessing from the frontier.
    context.assignedWaypoint = claimedForFeature(ctx, feature.id).find(
      (w) => w.claimedBy === session.id,
    )
  }
  return context
}

export function toolResolveWaypoint(
  ctx: AppCtx,
  session: SessionRow,
  input: { id: string; disposition: 'resolved' | 'dropped'; summary: string },
): { ok: true } {
  // Resolving is a map move on a feature, so it needs one — the guard is what
  // makes a project-scoped session's call a legible refusal rather than a
  // NotFound on an id it had no business knowing.
  requireFeatureId(session)
  // The prose answer is written to decisions.md/map.md by the session directly;
  // this tool flips machinery only (status → terminal, cascade unblock events).
  resolveWaypoint(ctx, input.id, input.disposition, input.summary)
  return { ok: true }
}

export function toolEmitTickets(
  ctx: AppCtx,
  session: SessionRow,
  input: { tickets: TicketInputT[] },
): { stored: number; ids: string[] } {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  // `storeTickets` is the mutation and emits the single `tickets.stored` event
  // (one mutation → one event). This tool used to emit an additional
  // `tickets.emitted` note, which double-logged the same action on the timeline.
  const stored = storeTickets(ctx, feature.id, input.tickets)
  return { stored: stored.length, ids: stored.map((t) => t.id) }
}

/** Refuse cross-feature ticket surgery: the id must belong to THIS session's feature. */
function requireOwnTicket(ctx: AppCtx, session: SessionRow, ticketId: string): Ticket {
  // Scope first, existence second: a session with no feature has no business
  // asking about any ticket, and telling it "that id doesn't exist" would send
  // it hunting for a better id instead of at the tools it actually has.
  const featureId = requireFeatureId(session)
  const ticket = getTicket(ctx, ticketId)
  if (ticket.featureId !== featureId) {
    throw new GateError(`ticket ${ticketId} does not belong to this session's feature`)
  }
  return ticket
}

export function toolUpdateTicket(
  ctx: AppCtx,
  session: SessionRow,
  input: { id: string } & TicketContentPatch,
): { ok: true; ticket: Ticket } {
  requireOwnTicket(ctx, session, input.id)
  const { id, ...patch } = input
  return { ok: true, ticket: editTicket(ctx, id, patch) }
}

export function toolCancelTicket(
  ctx: AppCtx,
  session: SessionRow,
  input: { id: string; reason?: string },
): { ok: true; ticket: Ticket } {
  requireOwnTicket(ctx, session, input.id)
  return { ok: true, ticket: cancelTicket(ctx, input.id, input.reason) }
}

export function toolEscalateToMap(
  ctx: AppCtx,
  session: SessionRow,
  input: { destination: string; notes?: string },
): { ok: true; warning?: string } {
  return escalateToMap(ctx, requireFeatureId(session), input)
}

export function toolEmitWaypoints(
  ctx: AppCtx,
  session: SessionRow,
  input: { waypoints: WaypointInputT[] },
): { stored: number; ids: string[] } {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  // Waypoints only exist on a map — every session on a mapped feature may branch
  // it (the recursion), but an unmapped feature must escalate first.
  if (!feature.mapped) {
    throw new GateError('feature is not mapped — call escalate_to_map before emitting waypoints')
  }
  const stored = storeWaypoints(ctx, feature.id, input.waypoints)
  return { stored: stored.length, ids: stored.map((w) => w.id) }
}

/**
 * The one tool both halves of the surface share, so it emits at whatever scope
 * the calling session has: a feature's timeline for every pipeline kind, the
 * project's for a project-scoped session (`feature_id` null, which the events
 * table already supports). A project session has milestones worth recording —
 * features created, a charter drafted — and refusing them a note would leave
 * the project stream blind to the one session that works at its scope.
 */
export function toolRecordEvent(
  ctx: AppCtx,
  session: SessionRow,
  input: { type: string; message: string },
): { ok: true } {
  const event = emitForSession(ctx, session, {
    type: input.type,
    message: input.message,
    data: { source: 'mcp' },
  })
  if (!event) {
    throw new GateError(
      `session ${session.id} belongs to neither a feature nor a project — nothing to record against`,
    )
  }
  return { ok: true }
}

export type CompletePhaseResult =
  | { ok: true; nextPhase: PhaseT; waitingOn?: string }
  | { ok: false; reason: string }

export function toolCompletePhase(
  ctx: AppCtx,
  session: SessionRow,
  input: { phase: PhaseT },
): CompletePhaseResult {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  emit(ctx, feature.id, {
    type: 'phase.complete_requested',
    message: `session marked phase '${input.phase}' complete`,
    data: { phase: input.phase, currentPhase: feature.phase },
  })

  // G3 (tickets → implementation) is THE human approval gate — the "Burn" click
  // in CONTEXT.md's two-click covenant (#9). A session may mark the tickets
  // phase's work complete, but it MUST NOT advance the feature past G3: only the
  // `feature.burn` tRPC mutation (or an explicit `overrideGate`) may cross it.
  // The feature parks at `tickets`, waiting on the human.
  const gate = nextGate(feature)
  if (gate?.id === 'G3') {
    const next = nextPhase(feature) ?? 'implementation'
    emit(ctx, feature.id, {
      type: 'tickets.awaiting_burn',
      message: 'tickets complete — waiting on the human Burn click (gate G3)',
      data: { phase: feature.phase, nextPhase: next, waitingOn: 'human burn' },
    })
    return { ok: true, nextPhase: next, waitingOn: 'human burn' }
  }

  try {
    // Non-G3 gates: same server-side check + advance as `feature.advance`.
    const updated = advance(ctx, feature.id)
    return { ok: true, nextPhase: updated.phase }
  } catch (e) {
    if (e instanceof GateError) return { ok: false, reason: e.message }
    throw e
  }
}

/**
 * Checkpoint the feature's knowledge docs into the talk worktree (SPEC §6):
 * best-effort, tolerating B2's `commitDocs` stub. Any failure is a warning
 * event, never a tool error.
 */
async function commitDocsCheckpoint(
  ctx: AppCtx,
  session: SessionRow,
  message: string,
): Promise<void> {
  try {
    await git.commitDocs(session.worktreePath, message)
  } catch (e) {
    emit(ctx, requireFeatureId(session), {
      type: 'git.commit_pending',
      message: isNotImplemented(e)
        ? 'docs checkpoint skipped (git service pending)'
        : `docs checkpoint failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { message },
    })
  }
}

// --- project-scoped tools (`prepare` + `project` sessions) ------------------

/**
 * The project a project-scoped tool call belongs to, or a refusal that says why.
 *
 * The mirror of {@link requireFeatureId}: exactly one of the two ids is set on
 * a session row, so a feature session lands here with nothing to resolve. The
 * message stays tool-agnostic — several tools sit behind this guard now — and
 * points back at the surface the caller does have.
 */
function requireProject(ctx: AppCtx, session: SessionRow): Project {
  if (!session.projectId) {
    throw new GateError(
      `this tool belongs to a project-scoped session; this is a ${session.kind} session on a ` +
        'feature. Use get_feature_context and the pipeline tools for feature work.',
    )
  }
  const project = getProjectById(ctx, session.projectId)
  if (!project) throw new GateError(`project ${session.projectId} not found`)
  return project
}

export interface RecordFindingResult {
  ok: true
  key: PreparedKeyT
  source: FindingSourceT
  /** Set when the write was refused because a human already owns the key. */
  skipped?: string
}

/**
 * Store one established preparation value from an interactive session.
 *
 * The provenance split is the whole point, and it is NOT "whichever process
 * wrote the row". `userSupplied` means the human gave or confirmed this value
 * verbatim, which makes it `human` — and `human` is the source that permanently
 * locks a key against future auto-overwrite. Everything the agent worked out
 * itself, even with a human watching, is `session`: better attested than a
 * headless finding, but still something a later run may improve on.
 *
 * Recording the agent's own measurement as `human` would be the damaging
 * mistake — it would silently retire the key from every future preparation run,
 * and the only way back is clearing a field the user never typed.
 *
 * The existing human-ownership rule still applies on top: a key a human already
 * set is never overwritten here, and the refusal is reported rather than
 * swallowed, so the agent can say so instead of believing it succeeded.
 */
export function toolRecordFinding(
  ctx: AppCtx,
  session: SessionRow,
  input: { key: PreparedKeyT; value: string; evidence?: string; userSupplied?: boolean },
): RecordFindingResult {
  const project = requireProject(ctx, session)
  const source: FindingSourceT = input.userSupplied ? 'human' : 'session'

  if (!isOverwritable(ctx, project.id, input.key) && !input.userSupplied) {
    return {
      ok: true,
      key: input.key,
      source,
      skipped: `${input.key} was set by a human and is not auto-overwritable — ask them to clear it first if it should change`,
    }
  }

  recordFinding(ctx, project.id, {
    key: input.key,
    value: input.value,
    source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  })

  emitProject(ctx, project.id, {
    type: 'prep.finding_recorded',
    message: `preparation session established ${input.key} (${source})`,
    data: { key: input.key, source, sessionId: session.id },
  })
  return { ok: true, key: input.key, source }
}

/**
 * Drive what preparation recorded (decisions 1, 8): the server runs its real
 * test-drive machinery under a synthetic identity, and the prep session watches.
 *
 * Gated to `prepare` for two reasons that point the same way. It starts
 * services and creates a database on the host, which is exactly the authority a
 * preparation conversation has and no other session does; and the values it
 * proves are the ones this session just established, so anywhere else it would
 * be proving somebody else's homework.
 *
 * Everything it returns is what the machinery SAW — hook output tails, the
 * variable names it rendered, the URL it sniffed and whether that URL answers —
 * because the agent's job
 * between the halves is to check the things the server cannot (is the database
 * fresh, did migrations apply) and decide whether to fix and re-run. The verdict
 * itself is computed server-side and is not open to argument.
 */
export async function toolDryRunDrive(
  ctx: AppCtx,
  session: SessionRow,
  input: { action: 'start' | 'status' | 'stop' },
): Promise<git.DryRunResult> {
  const project = requireProject(ctx, session)
  if (session.kind !== 'prepare') {
    throw new GateError(
      `the dry-run drive belongs to a preparation conversation, and this is a ${session.kind} ` +
        'session. It starts services and creates a database on the human\'s machine — only the ' +
        'session that established those values may run them.',
    )
  }
  return git.dryRunDrive(ctx, project, input.action)
}

// --- run identity: the review agent's two wires (improve-workflow) ----------

/**
 * Who a RUN-scoped tool call is from. Not a conversation: a review ticket
 * burning at the tail of a run has no terminal and no session row, so it
 * identifies itself with the `X-Runcastle-Run` header naming the run it is
 * executing under, and the feature comes from that run rather than from
 * anything the agent says.
 */
export interface RunIdentity {
  runId: string
  featureId: string
}

function headerRunId(extra: HeaderCarrier): string | undefined {
  return identityHeader(extra, RUN_HEADER)
}

/**
 * The run a tool call belongs to, or null.
 *
 * A run that has already finished resolves to nothing: the header outlives the
 * burn (an agent process can survive its run being cancelled), and a stale one
 * must not be able to switch the human's checkout or write notes minutes later.
 */
export function resolveRunIdentity(ctx: AppCtx, runId: string | undefined): RunIdentity | null {
  if (!runId) return null
  const run = tryGetRun(ctx, runId)
  if (!run || run.status !== 'running') return null
  return { runId: run.id, featureId: run.featureId }
}

/**
 * What the run-scoped tools are called with: the run header when the caller
 * carried one, and otherwise whichever session the request resolved to — kept
 * only so the refusal can name it.
 */
export interface RunCaller {
  runId?: string
  session?: SessionRow
}

/**
 * The gate both review wires share, and the socket the runner plugs into: these
 * tools are reachable exactly when the caller carries a live run identity.
 *
 * Gated for the same reason `dry_run_drive` is gated to preparation. One boots
 * the app on the human's machine and the other writes into the feature's review
 * record — authority that belongs to the agent the runner launched for this
 * feature, and to no ordinary talk session, which has neither the header nor a
 * reason to want it.
 */
function requireRunIdentity(ctx: AppCtx, caller: RunCaller, tool: string): RunIdentity {
  const identity = resolveRunIdentity(ctx, caller.runId)
  if (identity) return identity
  const who = caller.session
    ? `this is a ${caller.session.kind} session`
    : 'this call carries no run identity'
  throw new GateError(
    `${tool} belongs to a review ticket burning under a run, and ${who}. It acts on the ` +
      "human's machine under the run's authority — only the review agent the runner launches " +
      'may call it.',
  )
}

/**
 * Boot the integrated feature branch so a review ticket can drive it
 * (improve-workflow decisions 3, 4): the server's REAL test-drive machinery,
 * started under the run's identity instead of a human's click.
 *
 * The feature is the run's, never the agent's to name — a review ticket reviews
 * the branch it was burned for.
 */
export async function toolReviewDrive(
  ctx: AppCtx,
  caller: RunCaller,
  input: { action: 'start' | 'status' | 'stop' },
): Promise<git.ReviewDriveResult> {
  const identity = requireRunIdentity(ctx, caller, 'the review drive')
  const feature = getFeatureRow(ctx, identity.featureId)
  return git.reviewDrive(ctx, projectForFeature(ctx, feature), feature, input.action)
}

/**
 * Append one review finding as a test note, attributed to the agent
 * (improve-workflow decision 2). Findings ride the channel the human's own
 * observations already use, so promote-to-fix-ticket works on them unchanged.
 */
export function toolAddTestNote(
  ctx: AppCtx,
  caller: RunCaller,
  input: { text: string },
): TestNote {
  const identity = requireRunIdentity(ctx, caller, 'add_test_note')
  return addNote(ctx, identity.featureId, input.text, 'agent')
}

/** What one `retry_drive` attempt observed, as the drive-fix agent reads it. */
export interface RetryDriveResult {
  /**
   * Whether the fresh drive STARTED. Its setup may still have failed — that is
   * `drive.hookFailure`, and reading on is the whole point of the loop.
   */
  ok: boolean
  /** Why the start was refused (an uncommitted tree, an active run). */
  deniedReason?: string
  /** Whether a drive was still holding the slot and was stopped first. */
  stopped: boolean
  /** The branch under the wheel, when one started. */
  branch?: string
  /**
   * The fresh drive exactly as the human's panel sees it: the setup failure if
   * it failed again, the NAMES of the variables setup wrote, the dev pane, the
   * sniffed URL and whether it answers yet.
   */
  drive?: git.DriveInfo
}

/**
 * Retry the drive this session was opened to fix (decision 9) — the fix→retry
 * half of the loop, and the only tool a drive-fix session has that no other
 * session does.
 *
 * Stopping first is not optional and not the agent's job to remember: the failed
 * drive is still holding the singleton slot with the feature branch checked out,
 * and a start is refused while it does. An already-stopped slot is tolerated
 * (the human may have stopped it from the UI), which is what makes this callable
 * as many times as the fix takes.
 */
export async function toolRetryDrive(
  ctx: AppCtx,
  session: SessionRow,
): Promise<RetryDriveResult> {
  if (session.kind !== 'drive-fix') {
    throw new GateError(
      `retrying a drive belongs to a drive-fix session, and this is a ${session.kind} session. ` +
        "It stops and restarts a test drive on the human's machine — only the session opened on " +
        'that failed drive may do that; everyone else asks the human to drive from the review panel.',
    )
  }
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  const project = projectForFeature(ctx, feature)

  const stopped = git.activeTestDriveFeatureId() === feature.id
  if (stopped) await git.testDrive(ctx, project, feature, 'stop')

  const start = await git.testDrive(ctx, project, feature, 'start')
  const drive = git.activeDriveInfo()
  return {
    ok: start.ok,
    stopped,
    ...(start.deniedReason ? { deniedReason: start.deniedReason } : {}),
    ...(start.branch ? { branch: start.branch } : {}),
    ...(drive ? { drive } : {}),
  }
}

// --- the project session's three tools (decisions 15, 19, 21) ---------------

export interface CreateFeatureResult {
  id: string
  slug: string
  branch: string
  phase: PhaseT
}

/** The feature-scoped talk kinds that may park a draft (draft-features decision 6). */
const DRAFTING_KINDS: readonly SessionKindT[] = ['ideation', 'revisit', 'waypoint', 'converge']

/**
 * The project a `create_feature` call belongs to — and, on the way there, how
 * much of the door the calling session may open (draft-features decision 6).
 *
 * A project-scoped session keeps the whole door. A feature-scoped TALK session
 * gets exactly one move: park a draft, so scope creep surfaced mid-grill has
 * somewhere to go instead of swallowing the feature being grilled — its project
 * is the one its own feature belongs to. Anything beyond parking is refused,
 * because a grill that can spawn live features is an orchestrator, and that is
 * the project session's job. `qa` is refused outright: its contract is
 * read-only, and a draft is still a write.
 */
function createFeatureProject(
  ctx: AppCtx,
  session: SessionRow,
  input: { draft?: boolean; tickets?: string[] },
): Project {
  if (isProjectSessionKind(session.kind)) return requireProject(ctx, session)
  if (!DRAFTING_KINDS.includes(session.kind)) {
    throw new GateError(
      `a ${session.kind} session is read-only and may not create features, drafts included. ` +
        'Tell the human what is worth capturing; the project session is where features are made.',
    )
  }
  if (!input.draft || input.tickets) {
    throw new GateError(
      `a ${session.kind} session may only PARK a feature here: call create_feature with ` +
        '`draft: true` and a `brief` carrying why you deferred it. Cutting a branch — a full ' +
        'create or the quick-change `tickets` shape — belongs to the project session; tell the ' +
        'human to open it.',
    )
  }
  return projectForFeature(ctx, getFeatureRow(ctx, requireFeatureId(session)))
}

/**
 * The point of the project session: intake and decomposition terminating in a
 * feature (decision 19).
 *
 * Three shapes, one call. Without `ticket` it is the ordinary door — an
 * ideation-phase feature whose `brief.md` is the prose the intake conversation
 * just produced, so the reasoning about why this feature exists and what it
 * must not swallow survives the terminal closing. With `draft` it parks that
 * same feature instead of starting it (draft-features decision 5): a row and a
 * stored brief, no branch, until the human clicks Start. With `tickets` it is
 * the quick-change door (decision 21): ONE feature born at `implementation`
 * carrying a ticket per prose, created atomically with them — which is why this
 * is NOT the feature-less `emit_tickets` the session is deliberately denied.
 *
 * It launches nothing. Spawning terminals from inside a terminal would make
 * this session an orchestrator, where runcastle's premise is that the human
 * decides what to work on next; the rail polls, so the new card IS the feedback.
 */
export async function toolCreateFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: {
    title: string
    oneLiner: string
    baseBranch?: string
    brief?: string
    draft?: boolean
    tickets?: string[]
  },
): Promise<CreateFeatureResult> {
  const project = createFeatureProject(ctx, session, input)
  const feature = input.tickets
    ? await quickChange(ctx, {
        projectId: project.id,
        title: input.title,
        // Same list the overlay sends, through the same service function — so
        // the review-ticket append and every other quick-change invariant hold
        // identically on both doors.
        tickets: input.tickets,
        baseBranch: input.baseBranch,
      })
    : await createFeature(ctx, {
        projectId: project.id,
        title: input.title,
        oneLiner: input.oneLiner,
        baseBranch: input.baseBranch,
        brief: input.brief,
        draft: input.draft,
      })
  return {
    id: feature.id,
    slug: feature.slug,
    branch: feature.branch,
    phase: feature.phase,
  }
}

export interface ProjectContext {
  project: Project
  /** `CONTEXT.md` in full; absent when the project has no charter yet. */
  charter?: string
  /** Live ADRs in full — superseded ones are omitted (decision 13). */
  adrs: AdrDoc[]
  /** One line per feature (decision 14 part 2); see {@link featureIndexLine}. */
  featureIndex: string[]
}

/**
 * Everything that is true of the project right now: the row, the charter, the
 * live ADRs, and a one-line index of every feature.
 *
 * The docs are read from THIS SESSION's worktree, not the human's checkout —
 * the project session works on a runcastle-owned branch (decision 18), so its
 * own tree is the state it is editing and the state it should be told about.
 *
 * No size ceiling and no truncation (decision 16): a ceiling would silently
 * turn "this binds you" into "this binds you unless it did not fit".
 */
export function toolGetProjectContext(ctx: AppCtx, session: SessionRow): ProjectContext {
  const project = requireProject(ctx, session)
  const charter = readCharter(session.worktreePath)
  return {
    project,
    ...(charter !== undefined ? { charter } : {}),
    adrs: listLiveAdrs(session.worktreePath),
    featureIndex: listFeatures(ctx, project.id).map(featureIndexLine),
  }
}

/**
 * One feature, one line. A shipped feature gets its slug, one-liner and docs
 * path — its record is on disk and readable. An in-flight one gets its title and
 * status and nothing else: it is not real yet (decision 16), so advertising a
 * one-liner and a docs path that only exist on an unmerged branch would promise
 * a read that cannot happen.
 */
function featureIndexLine(feature: Feature): string {
  if (feature.status === 'shipped') {
    return `${feature.slug} — ${feature.oneLiner} [shipped] ${featureDocsRel(feature.slug)}/`
  }
  return `${feature.title} [${feature.status === 'archived' ? 'archived' : 'in flight'}]`
}

/** One ticket as history: what it touched and what came of it, never its intent. */
export interface WorkRecordTicket {
  seq: number
  title: string
  status: TicketStatusT
  seams: string[]
  commits: string[]
  error?: string
  /** The burner's own account of the work, written just before it signalled done. */
  digest?: string
}

export interface WorkRecordRun {
  workflow: string
  status: RunStatusT
  startedAt: number
  endedAt?: number
  summary?: string
}

export interface WorkRecordFeature {
  slug: string
  title: string
  status: FeatureStatusT
  /** When the merge landed (`feature.shipped`); absent while unmerged. */
  shippedAt?: number
  runs: WorkRecordRun[]
  tickets: WorkRecordTicket[]
}

/**
 * The work record (decision 15): facts about what features actually DID.
 *
 * Deliberately never a ticket's `goal`, `context` or `acceptanceCriteria` —
 * those are intent at a moment, written before the code existed, and the burner
 * may have satisfied them by another route. Handing them to a later session is
 * handing it a decayed spec with none of the decay stamp. What survives is the
 * residue that cannot be wrong later: seams, commits, status, error, timings,
 * and the title as a label rather than a claim.
 *
 * The `digest` is prose and still a fact: the burner wrote it AFTER the work, as
 * its account of what it actually did, what surprised it and what it left alone
 * (decision 4). It carries the decay stamp intent lacks — it describes the code
 * that exists rather than the code someone hoped for — so it belongs here. The
 * run-level aggregate does not: it is these same digests re-concatenated, and
 * serving both would double the response for no new fact (decision 7).
 *
 * Queryable two ways. By slug: "what did X actually do?". By seam: "who has
 * touched this before?" — a case-insensitive SUBSTRING match, because seams are
 * uncoordinated free prose across features (decision 27) and exact equality
 * would under-report invisibly. A feature contributes only its matching tickets.
 */
export function toolGetWorkRecord(
  ctx: AppCtx,
  session: SessionRow,
  input: { featureSlug?: string; seam?: string },
): { features: WorkRecordFeature[] } {
  const project = requireProject(ctx, session)
  const slug = input.featureSlug?.trim()
  const seam = input.seam?.trim().toLowerCase()
  if (!slug && !seam) {
    throw new InvalidInputError('get_work_record needs a featureSlug or a seam to look up')
  }

  const records: WorkRecordFeature[] = []
  for (const feature of listFeatures(ctx, project.id)) {
    if (slug && feature.slug !== slug) continue
    let tickets = listByFeature(ctx, feature.id)
    if (seam) {
      tickets = tickets.filter((t) => t.seams.some((s) => s.toLowerCase().includes(seam)))
      if (tickets.length === 0) continue
    }
    const shippedAt = latestEventTs(ctx, feature.id, 'feature.shipped')
    records.push({
      slug: feature.slug,
      title: feature.title,
      status: feature.status,
      ...(shippedAt !== undefined ? { shippedAt } : {}),
      runs: listRunsByFeature(ctx, feature.id).map((r) => ({
        workflow: r.workflow,
        status: r.status,
        startedAt: r.startedAt,
        ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
        ...(r.summary !== undefined ? { summary: r.summary } : {}),
      })),
      tickets: tickets.map((t) => ({
        seq: t.seq,
        title: t.title,
        status: t.status,
        seams: t.seams,
        commits: t.commits,
        ...(t.error !== undefined ? { error: t.error } : {}),
        ...(t.digest !== undefined ? { digest: t.digest } : {}),
      })),
    })
  }
  return { features: records }
}

// --- MCP server assembly ----------------------------------------------------

function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

function noSession(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: 'No active runcastle session. Launch a session from the runcastle UI first.',
      },
    ],
    isError: true,
  }
}

async function resolveCtxSession(extra: HeaderCarrier): Promise<{ ctx: AppCtx; session: SessionRow } | null> {
  const ctx = await getRuntimeCtx()
  const session = resolveSession(ctx, headerSessionId(extra))
  return session ? { ctx, session } : null
}

/**
 * The caller of a run-scoped tool. Unlike a session tool this never refuses for
 * want of a session — a review agent HAS no session — so the gate is the run
 * header, checked in `requireRunIdentity`; the session is resolved only when
 * there is no run header, to make the refusal name who called.
 */
async function resolveRunCaller(extra: HeaderCarrier): Promise<{ ctx: AppCtx; caller: RunCaller }> {
  const ctx = await getRuntimeCtx()
  const runId = headerRunId(extra)
  if (runId) return { ctx, caller: { runId } }
  const session = resolveSession(ctx, headerSessionId(extra))
  return { ctx, caller: session ? { session } : {} }
}

/** Build a fresh MCP server with the runcastle tools registered. */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'runcastle', version: '0.1.0' })

  server.registerTool(
    'record_finding',
    {
      title: 'Record a preparation finding',
      description:
        'Store one established project setting from a preparation conversation. ' +
        'Set userSupplied: true ONLY when the human gave you this value or confirmed it verbatim — ' +
        'that marks it as theirs and stops any future automatic run from overwriting it. ' +
        'Anything you worked out yourself must leave it false, even if they were watching. ' +
        'Always include evidence: what you ran, or what the human told you.',
      inputSchema: {
        key: PreparedKey,
        value: z.string(),
        evidence: z.string().optional(),
        userSupplied: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolRecordFinding(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'dry_run_drive',
    {
      title: 'Dry-run the test drive',
      description:
        'Prove the drive keys you recorded by having the server run its REAL test-drive ' +
        'machinery — same identity variables, same hooks, same dev pane — under a synthetic ' +
        'identity (slug `prep-dry-run`) on the current branch. Nothing is checked out. `start` ' +
        'runs driveSetupCommand, overlays the `.runcastle/drive.env` it wrote and spawns ' +
        'devCommand; `status` reports the pane, the sniffed localhost URL and whether that URL ' +
        'answers HTTP yet (`devReady`) while you inspect; `stop` runs driveStopCommand and rules on ' +
        'the run. Ask the human before starting: it starts services and creates a database on ' +
        'their machine. A clean full pass stamps the participating keys verified, computed from ' +
        'what the machinery observed — your own checks decide whether to fix and re-run, never ' +
        'the stamp.',
      inputSchema: { action: z.enum(['start', 'status', 'stop']) },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(await toolDryRunDrive(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'review_drive',
    {
      title: 'Drive the feature branch for review',
      description:
        'Boot the integrated feature branch so you can review it. Runs the REAL test-drive ' +
        "machinery on the human's checkout under your run's identity: `start` switches the " +
        'checkout to the feature branch, renders driveEnv (per-branch database), runs ' +
        'driveSetupCommand and spawns devCommand; `status` reports the drive and hands back the ' +
        'localhost URL once the dev server has printed one — poll it, the URL is not ready at ' +
        'start; `stop` tears the environment down and puts the checkout back. ALWAYS stop what ' +
        'you started, including when the review goes wrong: the drive holds a machine-wide slot ' +
        'and the human cannot use their own checkout until you release it. Refusals are final, ' +
        'never worth retrying in a loop — a dirty tree or a drive the human is already running ' +
        'means this review cannot run, and reporting that is the honest outcome.',
      inputSchema: { action: z.enum(['start', 'status', 'stop']) },
    },
    async (args, extra) => {
      const rc = await resolveRunCaller(extra)
      return ok(await toolReviewDrive(rc.ctx, rc.caller, args))
    },
  )

  server.registerTool(
    'add_test_note',
    {
      title: 'Add a review note',
      description:
        'Record one review finding on the feature you are reviewing. It lands in the same notes ' +
        'the human writes while test-driving — attributed to you — so it shows up in the review ' +
        'panel, where the human triages every open note at once into fix tickets or the next ' +
        'lap’s session. One note per finding, written ' +
        'as an observation the human can reproduce (what you did, what happened, what you ' +
        'expected), plus a closing note summarising the pass. Findings are not failure: report ' +
        'what you saw and let the human decide.',
      inputSchema: { text: z.string().min(1) },
    },
    async (args, extra) => {
      const rc = await resolveRunCaller(extra)
      return ok(toolAddTestNote(rc.ctx, rc.caller, args))
    },
  )

  server.registerTool(
    'retry_drive',
    {
      title: 'Retry this feature’s test drive',
      description:
        'Drive-fix sessions only. Stop the failed drive if it is still holding the wheel, then ' +
        'start a fresh drive of this feature — the real machinery, the same hooks, the same dev ' +
        'pane the human clicks. Commit your fix to the feature branch first: a drive will not ' +
        'start on an uncommitted tree, and the branch is what carries its own setup. The reply is ' +
        'what the machinery saw — `drive.hookFailure` when setup failed again (with the command, ' +
        'the exit code and its output tail), `drive.envKeys` for the variable names setup handed ' +
        'back, and `drive.devUrl` / `drive.devReady` for whether the app is serving yet. Call it ' +
        'as many times as the fix takes.',
      inputSchema: {},
    },
    async (_args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(await toolRetryDrive(rs.ctx, rs.session))
    },
  )

  server.registerTool(
    'create_feature',
    {
      title: 'Create a feature',
      description:
        'Create a feature from the project session — the end of intake. Pass `brief` with the ' +
        'reasoning you just worked out with the human (why this feature exists, what it must NOT ' +
        'swallow): it becomes brief.md verbatim, and without it that reasoning is lost. Pass ' +
        '`draft: true` to PARK it instead of starting it — a row and its brief, no branch and no ' +
        'files, until the human clicks Start; ask them per feature whether to start it now or ' +
        'park it. Pass ' +
        '`tickets: [prose, ...]` for a quick change — work too small to deserve a grill — which ' +
        'creates ONE feature at the implementation phase carrying a ticket per prose (plus the ' +
        'review ticket every batch closes with), and whose brief.md is those proses themselves ' +
        '(so `brief` is unused there). Send every sentence of one quick change in a single call: ' +
        'calling this ' +
        'once per ticket would make one feature per ticket. From a feature session (ideation, ' +
        'revisit, waypoint, converge) this tool parks drafts and nothing else: `draft: true` is ' +
        'required and the `tickets` shape is refused, so deflect scope creep here and leave full ' +
        'creation to the project session. This does NOT open ' +
        'a terminal on what it creates; the new card in the rail is the feedback, and the human ' +
        'decides what to work on next.',
      inputSchema: {
        title: z.string().min(1),
        oneLiner: z.string(),
        baseBranch: z.string().optional(),
        brief: z.string().optional(),
        draft: z.boolean().optional(),
        tickets: z.array(z.string()).min(1).optional(),
      },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(await toolCreateFeature(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'get_project_context',
    {
      title: 'Get project context',
      description:
        'The project as it stands: the project row, the charter (CONTEXT.md) in full, every live ' +
        'ADR in full (superseded ones are omitted), and a one-line index of every feature — ' +
        'shipped ones with their one-liner and docs path, in-flight ones by title only. Read a ' +
        "shipped feature's own docs with your ordinary file tools; the index says where they are.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolGetProjectContext(rs.ctx, rs.session))
    },
  )

  server.registerTool(
    'get_work_record',
    {
      title: 'Get work record',
      description:
        'What features actually DID — facts only: per feature its status, ship date, run ' +
        'summaries and tickets as { seq, title, status, seams, commits, error?, digest? }. The ' +
        "digest is the burner's own account, written after the work: what it did, what " +
        "surprised it, what it left undone. Never a ticket's goal or acceptance criteria: " +
        'those are intent from before the code existed. ' +
        'Query by `featureSlug` ("what did X do?") or by `seam` ("who has touched this area, and ' +
        'what happened?") — the seam match is a case-insensitive substring, because seams are ' +
        'free prose that differs between features. At least one argument is required.',
      inputSchema: { featureSlug: z.string().optional(), seam: z.string().optional() },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolGetWorkRecord(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'get_feature_context',
    {
      title: 'Get feature context',
      description:
        'Full context for the current feature: the feature row, its phase, all docs/features/<slug>/*.md contents, its tickets, and annotatedModels — the models the operator described a use case for, the only ones emit_tickets may assign (empty when they annotated none).',
      inputSchema: {},
    },
    async (_args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolGetFeatureContext(rs.ctx, rs.session))
    },
  )

  server.registerTool(
    'emit_tickets',
    {
      title: 'Emit tickets',
      description:
        'Store the ideation session\'s ticket batch. Each ticket: title, goal, context, acceptanceCriteria[], seams[], blockedBy[] (1-based positions within THIS batch), kind (optional, "implementation" by default; "review" for a ticket that verifies the integrated feature branch — block it on every implementation ticket so it runs last), model (optional; an id from get_feature_context\'s annotatedModels whose note gives a reason to deviate — omit it otherwise and the burn resolves the model the ordinary way).',
      inputSchema: { tickets: z.array(TicketInput) },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolEmitTickets(rs.ctx, rs.session, args)
      await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: tickets emitted (${result.stored})`)
      return ok(result)
    },
  )

  server.registerTool(
    'update_ticket',
    {
      title: 'Update ticket',
      description:
        'Rewrite a stored ticket\'s content — title, goal, context, acceptanceCriteria, seams — or its model assignment (any subset). `model` takes an id from get_feature_context\'s annotatedModels; pass "" to clear it and let the burn resolve the model the ordinary way. Only pending or failed tickets can be edited; done/cancelled tickets are history and burning tickets are already running. Use during a revisit when a decision change makes a ticket stale. Get ids from get_feature_context.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        goal: z.string().optional(),
        context: z.string().optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        seams: z.array(z.string()).optional(),
        model: z.string().optional(),
      },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolUpdateTicket(rs.ctx, rs.session, args)
      await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: ticket ${result.ticket.seq} updated`)
      return ok(result)
    },
  )

  server.registerTool(
    'cancel_ticket',
    {
      title: 'Cancel ticket',
      description:
        'Cancel a ticket that is no longer needed (terminal state; only pending or failed tickets). The burner skips cancelled tickets, and tickets blocked by a cancelled one still burn — cancellation counts as satisfied. Pass a short reason so the timeline explains why.',
      inputSchema: { id: z.string(), reason: z.string().optional() },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolCancelTicket(rs.ctx, rs.session, args)
      await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: ticket ${result.ticket.seq} cancelled`)
      return ok(result)
    },
  )

  server.registerTool(
    'escalate_to_map',
    {
      title: 'Escalate to map',
      description:
        'Escalate this grilling session into a map when the feature outgrows one context window. Flips the feature to mapped and scaffolds docs/features/<slug>/map.md, seeding Destination + Notes from your arguments (Not-yet-specified and Out-of-scope start empty). Idempotent: calling it on an already-mapped feature warns and changes nothing.',
      inputSchema: { destination: z.string(), notes: z.string().optional() },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolEscalateToMap(rs.ctx, rs.session, args)
      // Checkpoint the freshly-scaffolded map.md; skip when the call was a no-op
      // warning (already mapped) so we don't churn an empty commit.
      if (!result.warning) {
        await commitDocsCheckpoint(rs.ctx, rs.session, 'runcastle: escalate to map')
      }
      return ok(result)
    },
  )

  server.registerTool(
    'emit_waypoints',
    {
      title: 'Emit waypoints',
      description:
        'Batch-create waypoints on the map (the feature must already be mapped — call escalate_to_map first). Each waypoint: title, type (grilling|research|prototype|task), question, blockedBy[] (1-based positions within THIS batch, and/or ids of already-stored waypoints). Available from any session once mapped — any session may branch the map.',
      inputSchema: { waypoints: z.array(WaypointInput) },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolEmitWaypoints(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'resolve_waypoint',
    {
      title: 'Resolve waypoint',
      description:
        'End the current waypoint: `resolved` (its question is answered) or `dropped` (no longer needed). Write the decision prose to decisions.md (or the gist to map.md Out-of-scope for a drop) FIRST — this tool flips machinery only (marks the waypoint terminal, frees any dependents on the frontier). `summary` is the one-line gist shown in the UI. Call this exactly once, as the last thing you do.',
      inputSchema: { id: z.string(), disposition: WaypointDisposition, summary: z.string() },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolResolveWaypoint(rs.ctx, rs.session, args)
      await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: waypoint ${args.disposition}`)
      return ok(result)
    },
  )

  server.registerTool(
    'record_event',
    {
      title: 'Record event',
      description:
        'Add a note to the timeline (decisions recorded, spec saved, milestones) — the feature\'s ' +
        "timeline from a feature session, the project's from a project-scoped one.",
      inputSchema: { type: z.string(), message: z.string() },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(toolRecordEvent(rs.ctx, rs.session, args))
    },
  )

  server.registerTool(
    'complete_phase',
    {
      title: 'Complete phase',
      description:
        'Mark the named phase complete. Runs the gate check server-side and advances the feature to the next phase, or returns { ok: false, reason }. The tickets → implementation gate (G3) is the human "Burn" approval: completing the tickets phase records the work as done and returns { ok: true, nextPhase: "implementation", waitingOn: "human burn" } WITHOUT advancing — the human must click Burn.',
      inputSchema: { phase: Phase },
    },
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      const result = toolCompletePhase(rs.ctx, rs.session, args)
      if (result.ok) {
        await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: phase '${args.phase}' complete`)
      }
      return ok(result)
    },
  )

  return server
}

// --- Hono sub-app (mounted at /mcp) -----------------------------------------

const mcp = new Hono()

// Declare UTF-8 on JSON responses (see routes/hooks.ts — bare `application/json`
// invites CP1252 misdecoding by charset-less HTTP clients).
mcp.use('*', async (c, next) => {
  await next()
  if (c.res.headers.get('content-type') === 'application/json') {
    c.res.headers.set('content-type', 'application/json; charset=utf-8')
  }
})

mcp.all('*', async (c) => {
  const server = buildMcpServer()
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(c)
  return res ?? c.body(null, 202)
})

export default mcp
