import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  FeatureStatus as FeatureStatusT,
  FindingSource as FindingSourceT,
  GateDef,
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
  TicketStatus,
  WaypointDisposition,
  WaypointInput,
  agentDigestDocOrder,
  isAgentDigestDoc,
  isProjectSessionKind,
  modelRoster,
  nextGate,
  nextPhase,
  WITHHELD_FEATURE_DOCS,
} from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import { Hono } from 'hono'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError, NotFoundError, isNotImplemented } from '../errors'
import { RUN_HEADER } from '../launcher/artifacts'
import { getRuntimeCtx } from '../launcher/runtime'
import { getSessionRow, mostRecentLiveSession } from '../launcher/sessions'
import {
  advance,
  createFeature,
  escalateToMap,
  type FeatureListItem,
  list as listFeatures,
  quickChange,
} from '../services/features'
import { emit, emitForSession, emitProject, latestEventTs } from '../services/events'
import { isOverwritable, recordFinding } from '../services/findings'
import * as git from '../services/git'
import type { AdrDoc } from '../services/knowledge'
import { ADR_DIR_REL, listDocs, listLiveAdrs, readCharter, readDoc } from '../services/knowledge'
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
 * `mcp.json` (forwarded by `@hono/mcp` as `requestInfo.headers`). A caller with
 * no session header falls back to the most recently created live session — a
 * convenience for a hand-run client, NOT a general rule: a caller that presents
 * an `X-Runcastle-Run` header is a burner agent with no session at all, and it
 * must never be handed somebody else's conversation. That fallback used to fire
 * for run agents, silently binding a review agent to whatever human talk session
 * happened to be live and serving it that feature's context
 * (`docs/features/improve-workflow/outcome.md:255`). `resolveSession` now
 * refuses to fall back once a run header is present, and the run-scoped read
 * tools resolve to the RUN's own feature instead (see {@link resolveFeatureReader}).
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

/**
 * Resolve the session for a tool call: header first, else the live singleton.
 *
 * `runId` is the caller's OTHER identity header, and its only job here is to
 * suppress the fallback. A caller that named a run has told us it is not a
 * conversation; handing it the newest live session would bind a burner agent to
 * an unrelated human's feature, which is exactly the mis-binding this argument
 * exists to close. A run caller with a session header too (nothing writes one
 * today) still resolves that session — it named one, so it gets that one.
 */
export function resolveSession(
  ctx: AppCtx,
  sessionId: string | undefined,
  runId?: string | undefined,
): SessionRow | null {
  if (sessionId) {
    const byId = getSessionRow(ctx, sessionId)
    if (byId) return byId
  }
  if (runId) return null
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

/**
 * The `qa` kind's read-only contract, enforced instead of merely stated.
 *
 * `qa` is "come back and ask questions": three separate prompts forbid it the
 * write tools, and until now that was the whole enforcement — a qa session HAS a
 * feature, so every feature-shaped write tool let it through. The codebase's own
 * principle for exactly this (`launcher/edit-guard.ts:11`): a prompt rule is
 * advisory, a deny is not.
 *
 * The refusal names what to do instead, because there is a human in the room:
 * a qa session's output is what it TELLS them, not what it stores.
 */
function refuseIfReadOnly(session: SessionRow, action: string): void {
  if (session.kind !== 'qa') return
  throw new GateError(
    `a qa session is read-only, and ${action} is a write. Answer the human's question and tell ` +
      'them what should change — they open the session (revisit, ideation) that can make it.',
  )
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

/**
 * Who a feature READ is for: the feature to read, plus the session that asked
 * when a session asked at all.
 *
 * The second field is why this is not just a string. A waypoint session's
 * assignment is "the waypoint claimed BY THIS SESSION", so the reader has to
 * carry the session id — and a run agent, which has none, correctly gets no
 * assignment rather than somebody else's.
 */
export interface FeatureReader {
  featureId: string
  sessionId?: string
}

/**
 * The feature a read tool should serve, from whichever identity the caller has.
 *
 * The run header wins outright: a burner review agent has no session, and the
 * feature it may read is the one its RUN is burning — never one it names and
 * never one a live conversation happens to be on. A session caller resolves the
 * ordinary way, through the guard that refuses project-scoped kinds.
 */
export function resolveFeatureReader(ctx: AppCtx, caller: RunCaller): FeatureReader {
  if (caller.runId) {
    const identity = requireRunIdentity(ctx, caller, 'this feature read')
    return { featureId: identity.featureId }
  }
  if (!caller.session) {
    throw new GateError(
      'this call carries neither a session nor a live run identity — nothing to read a feature for.',
    )
  }
  return { featureId: requireFeatureId(caller.session), sessionId: caller.session.id }
}

/** One doc this payload did NOT inline, addressed well enough to go and get. */
export interface FeatureDocRef {
  relPath: string
  title: string
  /** Size of the file on disk, so the agent can budget before fetching it. */
  bytes: number
  /**
   * Why it was left out, for the docs the contract withholds by name
   * (`WITHHELD_FEATURE_DOCS`). Absent for an ordinary uncanonical doc — those
   * are simply not part of the digest, which is not the same as discouraged.
   */
  withheld?: string
}

/**
 * A ticket as the WORKING context sees it: everything a session needs to plan,
 * amend or burn, minus the burner's after-the-fact `digest`.
 *
 * The digest is dropped here for the same reason the run-level aggregate is
 * dropped from `get_work_record` (decision 7): `outcome.md` is literally built
 * by re-concatenating these digests (`services/outcome.ts`), so a payload that
 * inlines the outcome AND every digest pays twice for one set of facts. A
 * session that wants the burner's account asks `get_work_record`, which exists
 * for exactly that question.
 *
 * `goal`, `context` and `acceptanceCriteria` deliberately STAY: unlike the
 * digest they are the live work — the thing this session is here to edit, block,
 * cancel or complete — and a ticket without them is a title.
 */
export type FeatureContextTicket = Omit<Ticket, 'digest'>

export interface FeatureContext {
  feature: ReturnType<typeof getFeatureRow>
  phase: PhaseT
  /**
   * The lap the feature is on (SPEC §15.3). `tickets` below is the full history
   * across every lap — the `lap` on each row is what distinguishes them.
   */
  lap: number
  /**
   * The canonical docs (`AGENT_DIGEST_DOCS`) in full, in reading order:
   * brief → map → decisions → spec.
   */
  docs: { relPath: string; content: string }[]
  /** Every other doc that exists, as an index — fetch one with `read_feature_doc`. */
  moreDocs: FeatureDocRef[]
  /** Says, in the payload itself, that `moreDocs` is fetchable rather than gone. */
  docsNote: string
  tickets: FeatureContextTicket[]
  /**
   * The models the operator annotated with a use-case note, and the only ones a
   * ticket may be assigned (decisions.md #4). Notes ARE the opt-in: an operator
   * who annotated nothing gets an empty array here, and the emitting session
   * then never assigns a model at all — today's behaviour, unchanged.
   */
  annotatedModels: AnnotatedModel[]
  /** Mapped features only (ADR-0001 §13.3): every waypoint on the map… */
  waypoints?: WaypointT[]
  /**
   * …and the ids of the subset currently on the frontier (open, unclaimed,
   * unblocked). Ids rather than rows because the rows are already above, in
   * `waypoints` — this is the shape `getFeatureFull` serves the UI, for the
   * same reason.
   */
  frontierIds?: string[]
  /** Id of the waypoint THIS session claimed (kind=waypoint) — the one to work + resolve. */
  assignedWaypointId?: string
}

const DOCS_NOTE =
  'docs[] holds this feature’s canonical docs in full. moreDocs[] is everything else that ' +
  'exists in docs/features/<slug>/ — not inlined, not gone: read any of them with ' +
  'read_feature_doc({ relPath }). A `withheld` reason means it was left out on purpose; fetch ' +
  'it anyway if a ticket points at it.'

/**
 * Everything true of the feature right now, sized to be READ rather than
 * skimmed.
 *
 * The rule is `packages/core/src/docs.ts`: inline the four canonical docs, index
 * the rest. Before that rule this tool inlined every `.md` in the directory in
 * full, which on this repo's own `ux-issues` feature came to ~189 KB in a single
 * reply — most of it the previous lap's `outcome.md` and its already-triaged
 * `test-notes.md`, i.e. the postmortem of work the session was being asked to
 * continue past. An allowlist plus an index costs one extra call for the rare
 * doc that is actually wanted, and nothing at all for the common case.
 */
export function featureContext(ctx: AppCtx, reader: FeatureReader): FeatureContext {
  const feature = getFeatureRow(ctx, reader.featureId)

  const docs: { relPath: string; content: string }[] = []
  const moreDocs: FeatureDocRef[] = []
  for (const summary of listDocs(ctx, feature)) {
    let content: string
    try {
      content = readDoc(ctx, feature, summary.relPath).content
    } catch {
      content = ''
    }
    if (isAgentDigestDoc(summary.relPath)) {
      docs.push({ relPath: summary.relPath, content })
      continue
    }
    const withheld = WITHHELD_FEATURE_DOCS[summary.relPath.toLowerCase()]
    moreDocs.push({
      relPath: summary.relPath,
      title: summary.title,
      bytes: Buffer.byteLength(content, 'utf8'),
      ...(withheld ? { withheld } : {}),
    })
  }
  docs.sort((a, b) => agentDigestDocOrder(a.relPath) - agentDigestDocOrder(b.relPath))

  const context: FeatureContext = {
    feature,
    phase: feature.phase,
    lap: feature.lap,
    docs,
    moreDocs,
    docsNote: DOCS_NOTE,
    tickets: listByFeature(ctx, feature.id).map(stripDigest),
    annotatedModels: annotatedModels(ctx),
  }
  // A mapped feature also exposes its map state so any session can read the
  // waypoints and pick up the frontier (claiming stays a server-only effect).
  if (feature.mapped) {
    context.waypoints = listWaypoints(ctx, feature.id)
    context.frontierIds = waypointFrontier(ctx, feature.id).map((w) => w.id)
    // A waypoint session works exactly the waypoint it claimed — surface it so
    // the entry skill knows its assignment without guessing from the frontier.
    // A run agent has no session id, so it correctly has no assignment.
    const assigned = reader.sessionId
      ? claimedForFeature(ctx, feature.id).find((w) => w.claimedBy === reader.sessionId)
      : undefined
    if (assigned) context.assignedWaypointId = assigned.id
  }
  return context
}

function stripDigest(ticket: Ticket): FeatureContextTicket {
  const { digest: _digest, ...rest } = ticket
  return rest
}

export function toolGetFeatureContext(ctx: AppCtx, session: SessionRow): FeatureContext {
  return featureContext(ctx, {
    featureId: requireFeatureId(session),
    sessionId: session.id,
  })
}

/**
 * One feature doc, in full — the other half of the digest contract.
 *
 * `get_feature_context` indexes what it does not inline; this is how the index
 * is cashed in. `readDoc` is the traversal-guarded reader the tRPC surface
 * already uses, so a `relPath` that climbs out of the docs dir is refused here
 * exactly as it is there.
 */
export function toolReadFeatureDoc(
  ctx: AppCtx,
  reader: FeatureReader,
  input: { relPath: string },
): { relPath: string; content: string } {
  const feature = getFeatureRow(ctx, reader.featureId)
  return { relPath: input.relPath, content: readDoc(ctx, feature, input.relPath).content }
}

/** A ticket as an INDEX row: enough to name one and act on it, no prose. */
export interface TicketSummary {
  id: string
  seq: number
  title: string
  status: TicketStatusT
  kind: Ticket['kind']
  lap: number
  blockedBy: number[]
  seams: string[]
}

/**
 * This feature's tickets as an index, optionally filtered by status.
 *
 * It exists because the ONLY documented way to learn a ticket id used to be
 * `get_feature_context` — so renaming one ticket cost a session the entire
 * feature payload. `update_ticket`, `cancel_ticket` and every "which of these
 * is still pending?" question want a list of names and ids, and nothing else.
 */
export function toolListTickets(
  ctx: AppCtx,
  reader: FeatureReader,
  input: { status?: TicketStatusT },
): { tickets: TicketSummary[] } {
  const rows = listByFeature(ctx, reader.featureId).filter(
    (t) => !input.status || t.status === input.status,
  )
  return {
    tickets: rows.map((t) => ({
      id: t.id,
      seq: t.seq,
      title: t.title,
      status: t.status,
      kind: t.kind,
      lap: t.lap,
      blockedBy: t.blockedBy,
      seams: t.seams,
    })),
  }
}

/** A waypoint named the way the map speaks about it: id, seq and title. */
export interface WaypointRef {
  id: string
  seq: number
  title: string
}

export interface ResolveWaypointResult {
  ok: true
  /** Dependents this resolve just freed — the map's answer to "what now?". */
  unblocked: WaypointRef[]
  /** The whole frontier after the move (open, unclaimed, unblocked). */
  frontierIds: string[]
}

export function toolResolveWaypoint(
  ctx: AppCtx,
  session: SessionRow,
  input: { id: string; disposition: 'resolved' | 'dropped'; summary: string },
): ResolveWaypointResult {
  // Resolving is a map move on a feature, so it needs one — the guard is what
  // makes a project-scoped session's call a legible refusal rather than a
  // NotFound on an id it had no business knowing.
  const featureId = requireFeatureId(session)
  // The service already works out which dependents this frees (it emits a
  // `waypoint.unblocked` event per dependent) and then returns none of it, so
  // the session's next move was a whole `get_feature_context` to find out what
  // just happened. Diffing the frontier across the call recovers it here without
  // changing the service the UI shares.
  const before = new Set(waypointFrontier(ctx, featureId).map((w) => w.id))
  // The prose answer is written to decisions.md/map.md by the session directly;
  // this tool flips machinery only (status → terminal, cascade unblock events).
  resolveWaypoint(ctx, input.id, input.disposition, input.summary)
  const after = waypointFrontier(ctx, featureId)
  return {
    ok: true,
    unblocked: after
      .filter((w) => !before.has(w.id))
      .map((w) => ({ id: w.id, seq: w.seq, title: w.title })),
    frontierIds: after.map((w) => w.id),
  }
}

/** A stored ticket named the way the batch speaks about it: id, seq and title. */
export interface StoredTicketRef {
  id: string
  seq: number
  title: string
}

export function toolEmitTickets(
  ctx: AppCtx,
  session: SessionRow,
  input: { tickets: TicketInputT[] },
): { stored: number; tickets: StoredTicketRef[] } {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  refuseIfReadOnly(session, 'emitting tickets')
  // `storeTickets` is the mutation and emits the single `tickets.stored` event
  // (one mutation → one event). This tool used to emit an additional
  // `tickets.emitted` note, which double-logged the same action on the timeline.
  const stored = storeTickets(ctx, feature.id, input.tickets)
  // `seq` is the number the batch's own `blockedBy` speaks in and the number the
  // UI shows, and it is assigned HERE, by the store. Returning bare ids meant
  // the emitting session could not name what it had just written back to the
  // human without a second, far larger call.
  return {
    stored: stored.length,
    tickets: stored.map((t) => ({ id: t.id, seq: t.seq, title: t.title })),
  }
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
  refuseIfReadOnly(session, 'rewriting a ticket')
  const { id, ...patch } = input
  return { ok: true, ticket: editTicket(ctx, id, patch) }
}

export function toolCancelTicket(
  ctx: AppCtx,
  session: SessionRow,
  input: { id: string; reason?: string },
): { ok: true; ticket: Ticket } {
  requireOwnTicket(ctx, session, input.id)
  refuseIfReadOnly(session, 'cancelling a ticket')
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
): { stored: number; waypoints: WaypointRef[] } {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  // Waypoints only exist on a map — every session on a mapped feature may branch
  // it (the recursion), but an unmapped feature must escalate first.
  if (!feature.mapped) {
    throw new GateError('feature is not mapped — call escalate_to_map before emitting waypoints')
  }
  const stored = storeWaypoints(ctx, feature.id, input.waypoints)
  // Same reason as `emit_tickets`: the store assigns the global `seq` that later
  // `blockedBy` edges and the UI both speak in, and dropping it made the
  // emitting session re-read the whole feature to learn what it had just made.
  return {
    stored: stored.length,
    waypoints: stored.map((w) => ({ id: w.id, seq: w.seq, title: w.title })),
  }
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

/** The gate a phase transition has to satisfy, as an agent can act on it. */
export interface GateRequirement {
  id: string
  /** What must be true, in prose (`PIPELINE`'s own wording). */
  description: string
  /** The server-side check that decides it — the name in the gate log. */
  check: string
}

export type CompletePhaseResult =
  | {
      ok: true
      nextPhase: PhaseT
      waitingOn?: string
      /**
       * What the gate AFTER this one wants, so the session can do that work now
       * instead of calling `complete_phase` again to find out. Absent at the
       * final phase, which has no next gate.
       */
      nextGate?: GateRequirement
    }
  | { ok: false; reason: string; gate?: GateRequirement }

function requirement(gate: GateDef | null): GateRequirement | undefined {
  return gate ? { id: gate.id, description: gate.description, check: gate.check } : undefined
}

export function toolCompletePhase(
  ctx: AppCtx,
  session: SessionRow,
  input: { phase: PhaseT },
): CompletePhaseResult {
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  refuseIfReadOnly(session, 'completing a phase')
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
    // The gate past G3 is what the feature meets AFTER the burn — reported so
    // the session knows the shape of the rest of the lap, not so it acts now.
    const after = requirement(nextGate({ ...feature, phase: next }))
    return {
      ok: true,
      nextPhase: next,
      waitingOn: 'human burn',
      ...(after ? { nextGate: after } : {}),
    }
  }

  try {
    // Non-G3 gates: same server-side check + advance as `feature.advance`.
    const updated = advance(ctx, feature.id)
    // What the NEXT gate wants, computed from the feature as it now stands. A
    // session that has to guess this calls `complete_phase` speculatively to
    // read the refusal; saying it here turns a probe into a fact.
    const next = requirement(nextGate(updated))
    return { ok: true, nextPhase: updated.phase, ...(next ? { nextGate: next } : {}) }
  } catch (e) {
    if (e instanceof GateError) {
      const gate = requirement(nextGate(feature))
      return { ok: false, reason: e.message, ...(gate ? { gate } : {}) }
    }
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
    oneLiner?: string
    baseBranch?: string
    brief?: string
    draft?: boolean
    tickets?: string[]
  },
): Promise<CreateFeatureResult> {
  const project = createFeatureProject(ctx, session, input)
  // `oneLiner` is required by the ORDINARY door only. The quick-change door
  // derives it from the first ticket's prose (`quickChange`) and ignores
  // anything passed, so demanding it there made the schema lie about the call.
  if (!input.tickets && !input.oneLiner?.trim()) {
    throw new InvalidInputError(
      'create_feature needs a oneLiner — one line saying what this feature is. Only the ' +
        'quick-change shape (`tickets`) may omit it: there it comes from the first ticket.',
    )
  }
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
        oneLiner: input.oneLiner ?? '',
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

/** One live ADR as an index row — title and address, not the argument itself. */
export interface AdrRef {
  relPath: string
  title: string
  bytes: number
}

/**
 * Where a new feature would cut from, so intake can STATE its base instead of
 * cutting one silently (decisions 1, 2, 7). The agent assumes `current`, says so
 * in the create proposal, and passes it back as `create_feature`'s `baseBranch`.
 */
export interface BaseBranches {
  /** The human checkout's branch — the base to assume. `''` when HEAD is detached. */
  current: string
  /**
   * Whether `current` is a base a feature may actually fork from. False when the
   * checkout is parked on a `feature/*` branch (mid test drive) or detached —
   * the one case where there is no default and the agent must ask.
   */
  currentIsSelectable: boolean
  /** Every base a feature may fork from: local non-`feature/*` plus remote-only `origin/<name>`. */
  selectable: string[]
  /** The repo's main line — the suggestion to offer when `current` is unselectable. */
  detectedMain: string
}

export interface ProjectContext {
  project: Project
  /** `CONTEXT.md` in full; absent when the project has no charter yet. */
  charter?: string
  /**
   * Live ADRs as an INDEX — superseded ones are omitted (decision 13), and the
   * rest are named rather than inlined. Read one with `read_adr({ relPath })`.
   */
  adrs: AdrRef[]
  /** Says, in the payload itself, that `adrs` is fetchable rather than gone. */
  adrsNote: string
  /** One line per feature (decision 14 part 2); see {@link featureIndexLine}. */
  featureIndex: string[]
  /** The base a new feature would cut from; see {@link BaseBranches}. */
  baseBranches: BaseBranches
}

const ADRS_NOTE =
  'adrs[] is an index of the project’s LIVE decisions (superseded ones are already omitted), not ' +
  'their text. Read the ones your work touches with read_adr({ relPath }) — they bind you the ' +
  'same either way. They are also plain files in this worktree at docs/adr/.'

/**
 * Everything that is true of the project right now: the row, the charter, an
 * index of the live ADRs, a one-line index of every feature, and the base a new
 * feature would cut from.
 *
 * The docs are read from THIS SESSION's worktree, not the human's checkout —
 * the project session works on a runcastle-owned branch (decision 18), so its
 * own tree is the state it is editing and the state it should be told about.
 * The branches are the other way round: the base a feature should fork off is
 * the branch the HUMAN is on, which is the checkout's, never this session's.
 *
 * The ADRs were once inlined in full on decision 16's reasoning: a ceiling would
 * silently turn "this binds you" into "this binds you unless it did not fit".
 * That reasoning was about TRUNCATION, and indexing is not truncation — nothing
 * is dropped, cut short or made unreachable; the read is one `read_adr` away and
 * the index says so. It matters because the pruning decision 13 relies on never
 * fires in practice: across every real project in this repo's data, zero ADRs
 * are marked superseded, so "live ADRs only" was the whole corpus and 73% of an
 * 80 KB payload. The deferral recorded in
 * `docs/features/project-session-open-by-asking-orient-lazily/brief.md:13` is
 * this work.
 */
export async function toolGetProjectContext(
  ctx: AppCtx,
  session: SessionRow,
): Promise<ProjectContext> {
  const project = requireProject(ctx, session)
  const charter = readCharter(session.worktreePath)
  return {
    project,
    ...(charter !== undefined ? { charter } : {}),
    adrs: listLiveAdrs(session.worktreePath).map(adrRef),
    adrsNote: ADRS_NOTE,
    featureIndex: listFeatures(ctx, project.id).map(featureIndexLine),
    baseBranches: await baseBranches(project),
  }
}

/**
 * The branch facts intake needs to state a base rather than cut one silently.
 * `listBranches` is the same vocabulary the web base pickers use — `feature/*`
 * excluded, remote-only lines as `origin/<name>` — so a base the agent picks
 * here and a base a human picks in the form are the same set of things.
 */
async function baseBranches(project: Project): Promise<BaseBranches> {
  const { current, branches, remoteBranches } = await git.listBranches(project)
  const selectable = [...branches, ...remoteBranches]
  return {
    current,
    currentIsSelectable: selectable.includes(current),
    selectable,
    detectedMain: await git.detectMainBranch(project.repoPath),
  }
}

function adrRef(adr: AdrDoc): AdrRef {
  const firstLine = adr.content.split('\n', 1)[0] ?? ''
  const heading = firstLine.match(/^#\s+(.+)$/)
  return {
    relPath: adr.relPath,
    title: heading ? heading[1].trim() : adr.relPath,
    bytes: Buffer.byteLength(adr.content, 'utf8'),
  }
}

/**
 * One ADR out of this session's own worktree, in full.
 *
 * Guarded here rather than in the knowledge service because the service reads a
 * DIRECTORY and this reads a caller-named path: `relPath` comes from an agent,
 * so it is normalized to a name under `docs/adr/` and then checked to still
 * resolve inside it. Both spellings the index could plausibly be echoed back in
 * (`docs/adr/0001-x.md` and a bare `0001-x.md`) resolve to the same file.
 */
export function toolReadAdr(
  ctx: AppCtx,
  session: SessionRow,
  input: { relPath: string },
): { relPath: string; content: string } {
  requireProject(ctx, session)
  const root = resolve(join(session.worktreePath, ADR_DIR_REL))
  const name = input.relPath.replace(/\\/g, '/').replace(/^\.?\/*docs\/adr\//i, '')
  const target = resolve(root, name)

  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new InvalidInputError(`adr path escapes ${ADR_DIR_REL}: ${input.relPath}`)
  }
  if (!existsSync(target)) throw new NotFoundError(`adr not found: ${input.relPath}`)
  return { relPath: `${ADR_DIR_REL}/${name}`, content: readFileSync(target, 'utf8') }
}

/**
 * One feature, one line — and for an in-flight feature, one line the portfolio
 * lookup can actually be DONE with.
 *
 * A shipped feature gets its slug, one-liner and docs path: its record is on
 * disk and readable. Decision 16 then withheld everything from an in-flight
 * feature but its title, on the ground that a one-liner and a docs path living
 * only on an unmerged branch promise a read that cannot happen. That is right
 * about the DOCS PATH and it stays — but it was over-applied. The project
 * session's skill makes the portfolio lookup mandatory ("'I did not check' is
 * not a thing this session is allowed to say") and names collision-detection
 * between in-flight features as its job, while `get_work_record` matches on
 * SLUG — which this line never gave it. Slug, phase, lap and the ticket counts
 * are all in SQLite, are true of the feature rather than of a branch, and are
 * the difference between an index and a list of titles.
 */
function featureIndexLine(feature: FeatureListItem): string {
  if (feature.status === 'shipped') {
    return `${feature.slug} — ${feature.oneLiner} [shipped] ${featureDocsRel(feature.slug)}/`
  }
  if (feature.status === 'archived' || feature.status === 'draft') {
    return `${feature.slug} — ${feature.title} [${feature.status}]`
  }
  const state = [`in flight: ${feature.phase}`, `lap ${feature.lap}`]
  const counts = feature.ticketCounts
  if (counts.pending > 0) state.push(`${counts.pending} pending`)
  if (counts.burning > 0) state.push(`${counts.burning} burning`)
  if (feature.mapped) state.push('mapped')
  // The one-liner and the docs path stay withheld: both live on the unmerged
  // branch, and the docs cannot be read from this worktree at all.
  return `${feature.slug} — ${feature.title} [${state.join(', ')}]`
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
  const session = resolveSession(ctx, headerSessionId(extra), headerRunId(extra))
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

/**
 * The caller of a feature READ, from either identity. A run header binds to the
 * run's own feature; otherwise the resolved session's.
 */
async function resolveReader(
  extra: HeaderCarrier,
): Promise<{ ctx: AppCtx; reader: FeatureReader } | null> {
  const rc = await resolveRunCaller(extra)
  if (!rc.caller.runId && !rc.caller.session) return null
  return { ctx: rc.ctx, reader: resolveFeatureReader(rc.ctx, rc.caller) }
}

// --- who gets which tools ---------------------------------------------------

/**
 * The audience a built server is for: a session kind, a burner agent running
 * under a run (`run`), or `undefined` for "we could not tell".
 */
export type McpAudience = SessionKindT | 'run'

/** Every kind whose session belongs to a FEATURE (the complement of the two project kinds). */
const FEATURE_KINDS: readonly SessionKindT[] = [
  'ideation',
  'qa',
  'waypoint',
  'converge',
  'revisit',
  'drive-fix',
]

/** …and the same minus `qa`, whose contract is read-only (see {@link refuseIfReadOnly}). */
const FEATURE_WRITE_KINDS = FEATURE_KINDS.filter((k) => k !== 'qa')

const PROJECT_KINDS: readonly SessionKindT[] = ['prepare', 'project']

const ALL_AUDIENCES: readonly McpAudience[] = [...FEATURE_KINDS, ...PROJECT_KINDS, 'run']

/**
 * Which audiences each tool is registered for — derived from the RUNTIME gates
 * each tool already enforces, not from fresh policy: `requireFeatureId`,
 * `requireProject`, `requireRunIdentity`, the `kind !== 'prepare'` and
 * `kind !== 'drive-fix'` checks, `createFeatureProject`, and the qa refusals.
 * Every one of those call-time guards stays exactly where it is; this table only
 * decides what a session is TOLD about.
 *
 * The distinction that makes this worth doing at all: the permission allowlist
 * (`RUNCASTLE_MCP_ALLOW_RULES`) grants every tool to every session, and its own
 * comment argues correctly that a rule for a tool that can only be refused is
 * inert. A rule is inert because it costs nothing. A tool DEFINITION is not: the
 * full `tools/list` is ~14 KB of schema re-sent on every turn of every session,
 * and a mean two thirds of it names tools the calling kind cannot reach (for
 * `qa`, which can reach a handful, it was ~94%). Inert permission, expensive
 * definition — the two do not follow from each other.
 */
const TOOL_AUDIENCES: Record<string, readonly McpAudience[]> = {
  // Feature reads. Also reachable by a burner agent under a run header, which
  // binds to ITS OWN feature (a review agent reviewing a branch legitimately
  // wants that branch's context) — never to a live conversation's.
  get_feature_context: [...FEATURE_KINDS, 'run'],
  read_feature_doc: [...FEATURE_KINDS, 'run'],
  list_tickets: [...FEATURE_KINDS, 'run'],
  // Feature writes: `requireFeatureId` plus the qa read-only contract.
  emit_tickets: FEATURE_WRITE_KINDS,
  update_ticket: FEATURE_WRITE_KINDS,
  cancel_ticket: FEATURE_WRITE_KINDS,
  complete_phase: FEATURE_WRITE_KINDS,
  // Map moves stay open to `qa` on purpose: "any session may branch the map" is
  // the recursion (SPEC §13.3), and it is pinned by test as well as by prose.
  escalate_to_map: FEATURE_KINDS,
  emit_waypoints: FEATURE_KINDS,
  resolve_waypoint: FEATURE_KINDS,
  // Project-scoped: `requireProject`.
  record_finding: PROJECT_KINDS,
  get_project_context: PROJECT_KINDS,
  read_adr: PROJECT_KINDS,
  get_work_record: PROJECT_KINDS,
  // `createFeatureProject`: the project kinds get the whole door, the drafting
  // talk kinds get parking only, `qa` and `drive-fix` get nothing.
  create_feature: [...PROJECT_KINDS, ...DRAFTING_KINDS],
  // Single-kind tools, each gated on that kind at call time.
  dry_run_drive: ['prepare'],
  retry_drive: ['drive-fix'],
  // Run-scoped: `requireRunIdentity`.
  review_drive: ['run'],
  add_test_note: ['run'],
  // The one tool both halves share — it emits at whatever scope the caller has.
  // Not a run agent, though: `emitForSession` needs a session row.
  record_event: [...FEATURE_KINDS, ...PROJECT_KINDS],
}

/**
 * Whether `tool` should be registered for `audience`.
 *
 * An unrecognized audience — no headers, a session id that resolves to nothing,
 * a kind from a newer build — registers EVERYTHING. Guessing wrong in the other
 * direction would hand a live session a server with no tools and no way to say
 * so, which is a worse failure than an over-long list; the call-time guards
 * still refuse anything the caller may not do.
 */
function registeredFor(tool: string, audience: McpAudience | undefined): boolean {
  if (audience === undefined) return true
  if (!ALL_AUDIENCES.includes(audience)) return true
  return (TOOL_AUDIENCES[tool] ?? ALL_AUDIENCES).includes(audience)
}

/** The tool names a given audience is offered — the assertion tests read. */
export function toolsForAudience(audience: McpAudience | undefined): string[] {
  return Object.keys(TOOL_AUDIENCES)
    .filter((tool) => registeredFor(tool, audience))
    .sort()
}

/**
 * The phases a SESSION can complete. `shipped` is in `Phase` because features
 * reach it; it is excluded here because nothing reaches it by asking — a feature
 * ships when the human merges it, so offering it was offering a call that can
 * only be refused.
 */
const CompletablePhase = Phase.exclude(['shipped'])

/**
 * The shape of a timeline event tag: `subject.verb`, lowercase, dotted.
 *
 * Not a closed enum, because sessions legitimately record milestones the server
 * has no name for. But not free text either: every emitter in the codebase
 * writes this shape (`phase.complete_requested`, `waypoint.resolved`,
 * `tickets.stored`), the timeline is permanent, and a session that invents
 * `I finished the spec!` puts a row in it that nothing can ever filter on.
 */
const EventType = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/,
    'event type must be a lowercase dotted tag like `decision.recorded`',
  )

/**
 * Build a fresh MCP server carrying the tools `audience` can actually reach.
 *
 * Called per request (stateless mode), so the audience is resolved from the
 * request's own identity headers before assembly — see the route handler.
 */
export function buildMcpServer(audience?: McpAudience): McpServer {
  const server = new McpServer({ name: 'runcastle', version: '0.1.0' })
  const wants = (tool: string): boolean => registeredFor(tool, audience)

  if (wants('record_finding')) {
    server.registerTool(
      'record_finding',
      {
        title: 'Record a preparation finding',
        description:
          'Store one established project setting from a preparation conversation. Refuses from a ' +
          'feature session, and never overwrites a key a human already set (the refusal is ' +
          'reported as `skipped`, not thrown).',
        inputSchema: {
          key: PreparedKey.describe('Which project setting this value is for.'),
          value: z.string().describe('The value to store, exactly as it should be used.'),
          evidence: z
            .string()
            .optional()
            .describe(
              'How you know: the command you ran and its output, or what the human told you. ' +
                'Always send it — a value with no provenance cannot be re-checked later.',
            ),
          userSupplied: z
            .boolean()
            .optional()
            .describe(
              'True ONLY when the human gave you this value or confirmed it verbatim. That marks ' +
                'the key theirs and permanently stops future automatic runs from overwriting it. ' +
                'Anything you worked out yourself is false, even if they were watching.',
            ),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolRecordFinding(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('dry_run_drive')) {
    server.registerTool(
      'dry_run_drive',
      {
        title: 'Dry-run the test drive',
        description:
          'Prove the drive keys you recorded by running the REAL test-drive machinery — same ' +
          'identity variables, same hooks, same dev pane — under a synthetic identity (slug ' +
          '`prep-dry-run`) on the current branch. Nothing is checked out. Ask the human before ' +
          'starting: it starts services and creates a database on their machine. A clean full ' +
          'pass stamps the participating keys verified, computed from what the machinery ' +
          'observed — your own checks decide whether to fix and re-run, never the stamp. ' +
          'Preparation sessions only.',
        inputSchema: {
          action: z
            .enum(['start', 'status', 'stop'])
            .describe(
              '`start` runs driveSetupCommand, overlays the `.runcastle/drive.env` it wrote and ' +
                'spawns devCommand. `status` reports the pane, the sniffed localhost URL and ' +
                'whether that URL answers HTTP yet (`devReady`) — poll it while you inspect. ' +
                '`stop` runs driveStopCommand and rules on the run.',
            ),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolDryRunDrive(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('review_drive')) {
    server.registerTool(
      'review_drive',
      {
        title: 'Drive the feature branch for review',
        description:
          "Boot the integrated feature branch on the human's checkout, under your run's " +
          'identity, so you can review it. ALWAYS stop what you started, including when the ' +
          'review goes wrong: the drive holds a machine-wide slot and the human cannot use their ' +
          'own checkout until you release it. Refusals (a dirty tree, a drive the human is ' +
          'already running) are final and never worth retrying — reporting one is the honest ' +
          'outcome. Refused unless your call carries a live run identity.',
        inputSchema: {
          action: z
            .enum(['start', 'status', 'stop'])
            .describe(
              '`start` switches the checkout to the feature branch, renders driveEnv (per-branch ' +
                'database), runs driveSetupCommand and spawns devCommand. `status` reports the ' +
                'drive and hands back the localhost URL once the dev server has printed one — ' +
                'poll it, the URL is not ready at start. `stop` tears the environment down and ' +
                'puts the checkout back.',
            ),
        },
      },
      async (args, extra) => {
        const rc = await resolveRunCaller(extra)
        return ok(await toolReviewDrive(rc.ctx, rc.caller, args))
      },
    )
  }

  if (wants('add_test_note')) {
    server.registerTool(
      'add_test_note',
      {
        title: 'Add a review note',
        description:
          'Record one review finding on the feature you are reviewing. It lands in the same ' +
          'notes the human writes while test-driving — attributed to you — so it shows up in the ' +
          'review panel, where they triage every open note at once into fix tickets or the next ' +
          'lap. Findings are not failure: report what you saw and let the human decide. Refused ' +
          'unless your call carries a live run identity.',
        inputSchema: {
          text: z
            .string()
            .min(1)
            .describe(
              'ONE finding, written as an observation the human can reproduce: what you did, ' +
                'what happened, what you expected. Call the tool again per finding, and once ' +
                'more at the end with a note summarising the pass.',
            ),
        },
      },
      async (args, extra) => {
        const rc = await resolveRunCaller(extra)
        return ok(toolAddTestNote(rc.ctx, rc.caller, args))
      },
    )
  }

  if (wants('retry_drive')) {
    server.registerTool(
      'retry_drive',
      {
        title: 'Retry this feature’s test drive',
        description:
          'Stop the failed drive if it is still holding the wheel, then start a fresh drive of ' +
          'this feature — the real machinery, the same hooks, the same dev pane the human clicks. ' +
          'Commit your fix to the feature branch first: a drive will not start on an uncommitted ' +
          'tree, and the branch is what carries its own setup. The reply is what the machinery ' +
          'saw — `drive.hookFailure` when setup failed again (command, exit code, output tail), ' +
          '`drive.envKeys` for the variable names setup handed back, `drive.devUrl` / ' +
          '`drive.devReady` for whether the app is serving yet. Call it as many times as the fix ' +
          'takes. Drive-fix sessions only.',
        inputSchema: {},
      },
      async (_args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolRetryDrive(rs.ctx, rs.session))
      },
    )
  }

  // A drafting TALK session may only park a draft (`createFeatureProject`), so
  // it is offered only that shape — the quick-change and full-create arguments
  // it would be refused are neither described to it nor accepted from it. Same
  // guard at call time either way; this only stops charging a grill for the
  // project session's door. (Item 9: with the audience known, policy prose that
  // does not apply to the reader is simply not sent.)
  if (wants('create_feature') && audience !== undefined && DRAFTING_KINDS.includes(audience as SessionKindT)) {
    server.registerTool(
      'create_feature',
      {
        title: 'Park a feature draft',
        description:
          'Park scope that surfaced here but belongs elsewhere: a row and its brief, no branch ' +
          'and no files, until the human clicks Start. This is the ONLY create shape a feature ' +
          'session has — cutting a branch belongs to the project session; tell the human to open ' +
          'it. Nothing is launched: the new card in the rail is the feedback.',
        inputSchema: {
          title: z.string().min(1).describe('The parked feature’s name.'),
          oneLiner: z.string().min(1).describe('One line saying what it is.'),
          brief: z
            .string()
            .optional()
            .describe('Why you deferred it, and what it must not swallow. Stored verbatim.'),
          draft: z.literal(true).describe('Always true here — parking is the only move.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolCreateFeature(rs.ctx, rs.session, args))
      },
    )
  } else if (wants('create_feature')) {
    server.registerTool(
      'create_feature',
      {
        title: 'Create a feature',
        description:
          'Create a feature — the end of intake. Three shapes, one call: the ordinary door ' +
          '(title + oneLiner + brief), the parked draft (`draft: true`), and the quick change ' +
          '(`tickets`). It opens NO terminal on what it creates; the new card in the rail is the ' +
          'feedback, and the human decides what to work on next. From a feature session ' +
          '(ideation, revisit, waypoint, converge) only the draft shape is allowed — deflect ' +
          'scope creep here and leave full creation to the project session.',
        inputSchema: {
          title: z.string().min(1).describe('The feature’s name; its slug and branch derive from this.'),
          oneLiner: z
            .string()
            .optional()
            .describe(
              'One line saying what this feature is. Required for every shape EXCEPT `tickets`, ' +
                'where the first ticket’s prose becomes the one-liner and anything sent here is ' +
                'ignored.',
            ),
          baseBranch: z
            .string()
            .optional()
            .describe('Branch to cut from; defaults to the project’s main branch.'),
          brief: z
            .string()
            .optional()
            .describe(
              'The reasoning you just worked out with the human — why this feature exists and ' +
                'what it must NOT swallow. Becomes brief.md verbatim, and without it that ' +
                'reasoning is lost. Unused by the `tickets` shape, whose brief IS the proses.',
            ),
          draft: z
            .boolean()
            .optional()
            .describe(
              'PARK it instead of starting it: a row and its brief, no branch and no files, ' +
                'until the human clicks Start. Ask them per feature whether to start or park.',
            ),
          tickets: z
            .array(z.string().min(1))
            .min(1)
            .optional()
            .describe(
              'The quick-change shape: work too small to deserve a grill. Creates ONE feature at ' +
                'the implementation phase carrying a ticket per prose (plus the review ticket ' +
                'every batch closes with). Send every sentence of one quick change in a SINGLE ' +
                'call — calling this once per ticket makes one feature per ticket.',
            ),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolCreateFeature(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_project_context')) {
    server.registerTool(
      'get_project_context',
      {
        title: 'Get project context',
        description:
          'The project as it stands: the project row, the charter (CONTEXT.md) in full, an INDEX ' +
          'of every live ADR (superseded ones omitted) and a one-line index of every feature. ' +
          'ADR bodies are not inlined — read the ones your work touches with `read_adr`. Shipped ' +
          'features carry their one-liner and docs path (readable on disk); in-flight ones carry ' +
          'slug, phase, lap and ticket counts but no docs path, because their docs live on an ' +
          'unmerged branch. Use the slug with `get_work_record` to see what one actually did. ' +
          'Plus `baseBranches` — the branch a new feature would cut from: the checkout’s `current` ' +
          'branch, `currentIsSelectable` (false mid test drive or on a detached HEAD, the one case ' +
          'with no default), every `selectable` base, and the `detectedMain` line to suggest then.',
        inputSchema: {},
      },
      async (_args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolGetProjectContext(rs.ctx, rs.session))
      },
    )
  }

  if (wants('read_adr')) {
    server.registerTool(
      'read_adr',
      {
        title: 'Read an ADR',
        description:
          'One project-scope decision record, in full, out of this session’s own worktree — the ' +
          'other half of the ADR index `get_project_context` returns.',
        inputSchema: {
          relPath: z
            .string()
            .min(1)
            .describe(
              'The `relPath` from the index (`docs/adr/0001-example.md`); a bare filename works ' +
                'too. Refused if it resolves outside docs/adr/.',
            ),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolReadAdr(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_work_record')) {
    server.registerTool(
      'get_work_record',
      {
        title: 'Get work record',
        description:
          'What features actually DID — facts only: per feature its status, ship date, run ' +
          'summaries and tickets as { seq, title, status, seams, commits, error?, digest? }. The ' +
          'digest is the burner’s own account, written after the work: what it did, what ' +
          'surprised it, what it left undone. Never a ticket’s goal or acceptance criteria — ' +
          'those are intent from before the code existed. Send exactly one of the two arguments.',
        inputSchema: z.union([
          z.object({
            featureSlug: z
              .string()
              .min(1)
              .describe('A feature slug, exactly as `get_project_context`’s index spells it: "what did X do?"'),
            seam: z.string().min(1).optional(),
          }),
          z.object({
            featureSlug: z.string().min(1).optional(),
            seam: z
              .string()
              .min(1)
              .describe(
                'A surface, asked sideways: "who has touched this area, and what happened?" ' +
                  'Matched as a case-insensitive SUBSTRING of each ticket’s seams, because seams ' +
                  'are free prose that differs between features — so a short fragment ' +
                  '("router") finds more than an exact phrase.',
              ),
          }),
        ]),
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolGetWorkRecord(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_feature_context')) {
    server.registerTool(
      'get_feature_context',
      {
        title: 'Get feature context',
        description:
          'Everything true of the current feature: the feature row, its phase and lap, its ' +
          'canonical docs (brief, map, decisions, spec) in full, an INDEX of every other doc in ' +
          'docs/features/<slug>/ (read one with `read_feature_doc`), and its tickets. Mapped ' +
          'features also get their waypoints, `frontierIds`, and `assignedWaypointId` when this ' +
          'session claimed one. Tickets carry their goal, context and acceptance criteria but ' +
          'not the burner’s post-hoc digest — ask `get_work_record` for that. `annotatedModels` ' +
          'lists the models the operator described a use case for — the only ones `emit_tickets` ' +
          'may assign (empty when they annotated none).',
        inputSchema: {},
      },
      async (_args, extra) => {
        const r = await resolveReader(extra)
        if (!r) return noSession()
        return ok(featureContext(r.ctx, r.reader))
      },
    )
  }

  if (wants('read_feature_doc')) {
    server.registerTool(
      'read_feature_doc',
      {
        title: 'Read a feature doc',
        description:
          'One doc from this feature’s docs/features/<slug>/ directory, in full — the other half ' +
          'of the `moreDocs` index `get_feature_context` returns. A doc marked `withheld` there ' +
          'is fetchable too; the reason says whether it is worth your context.',
        inputSchema: {
          relPath: z
            .string()
            .min(1)
            .describe(
              'Path relative to the feature’s docs dir, exactly as `moreDocs[].relPath` spells ' +
                'it (`outcome.md`, `research/3-auth.md`). Refused if it escapes that dir.',
            ),
        },
      },
      async (args, extra) => {
        const r = await resolveReader(extra)
        if (!r) return noSession()
        return ok(toolReadFeatureDoc(r.ctx, r.reader, args))
      },
    )
  }

  if (wants('list_tickets')) {
    server.registerTool(
      'list_tickets',
      {
        title: 'List tickets',
        description:
          'This feature’s tickets as an index — { id, seq, title, status, kind, lap, blockedBy, ' +
          'seams } and no prose. This is where ids for `update_ticket` and `cancel_ticket` come ' +
          'from; use it instead of `get_feature_context` when you only need to find or name a ' +
          'ticket. Full ticket bodies are in `get_feature_context`.',
        inputSchema: {
          status: TicketStatus.optional().describe(
            'Return only tickets in this state. Omit for all of them, across every lap.',
          ),
        },
      },
      async (args, extra) => {
        const r = await resolveReader(extra)
        if (!r) return noSession()
        return ok(toolListTickets(r.ctx, r.reader, args))
      },
    )
  }

  if (wants('emit_tickets')) {
    server.registerTool(
      'emit_tickets',
      {
        title: 'Emit tickets',
        description:
          'Store this session’s ticket batch. Returns each stored ticket’s id, assigned `seq` ' +
          'and title — `seq` is the number the UI shows and the number later blockedBy edges ' +
          'speak in. Send the whole batch in one call: positions in `blockedBy` are positions ' +
          'within THIS call. A ticket’s optional `model` takes an id from `get_feature_context`’s ' +
          'annotatedModels whose note gives a reason to deviate — omit it otherwise and the burn ' +
          'resolves the model the ordinary way.',
        inputSchema: {
          tickets: z
            .array(TicketInput)
            .min(1)
            .describe('The whole batch, in the order you want them numbered.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        const result = toolEmitTickets(rs.ctx, rs.session, args)
        await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: tickets emitted (${result.stored})`)
        return ok(result)
      },
    )
  }

  if (wants('update_ticket')) {
    server.registerTool(
      'update_ticket',
      {
        title: 'Update ticket',
        description:
          'Rewrite a stored ticket’s content (any subset of the fields). Only pending or failed ' +
          'tickets can be edited: done/cancelled ones are history and burning ones are already ' +
          'running. Use during a revisit when a decision change makes a ticket stale. `model` ' +
          'reassigns the ticket’s model; pass "" to clear it and let the burn resolve the model ' +
          'the ordinary way.',
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe('The ticket id, from `list_tickets` (cheapest) or `get_feature_context`.'),
          title: z.string().optional().describe('New title.'),
          goal: z.string().optional().describe('New goal — what the burner must achieve.'),
          context: z.string().optional().describe('New context — what the burner needs to know first.'),
          acceptanceCriteria: z
            .array(z.string())
            .optional()
            .describe('Replaces the whole list, not appended to it.'),
          seams: z
            .array(z.string())
            .optional()
            .describe('Replaces the whole list. The surfaces this ticket touches, in free prose.'),
          model: z
            .string()
            .optional()
            .describe('An id from `get_feature_context`’s annotatedModels; "" clears the assignment.'),
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
  }

  if (wants('cancel_ticket')) {
    server.registerTool(
      'cancel_ticket',
      {
        title: 'Cancel ticket',
        description:
          'Cancel a ticket that is no longer needed — terminal, and only for pending or failed ' +
          'ones. The burner skips cancelled tickets, and tickets blocked by a cancelled one ' +
          'still burn: cancellation counts as satisfied.',
        inputSchema: {
          id: z.string().min(1).describe('The ticket id, from `list_tickets` or `get_feature_context`.'),
          reason: z
            .string()
            .optional()
            .describe('A short why, so the timeline explains the cancellation to the human.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        const result = toolCancelTicket(rs.ctx, rs.session, args)
        await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: ticket ${result.ticket.seq} cancelled`)
        return ok(result)
      },
    )
  }

  if (wants('escalate_to_map')) {
    server.registerTool(
      'escalate_to_map',
      {
        title: 'Escalate to map',
        description:
          'Escalate this feature into a map when it outgrows one context window. Flips the ' +
          'feature to mapped and scaffolds docs/features/<slug>/map.md. Idempotent: on an ' +
          'already-mapped feature it warns and changes nothing.',
        inputSchema: {
          destination: z
            .string()
            .min(1)
            .describe('Where this feature is going, in prose. Seeds map.md’s Destination section.'),
          notes: z
            .string()
            .optional()
            .describe(
              'What is already known or already ruled out. Seeds map.md’s Notes section; ' +
                'Not-yet-specified and Out-of-scope always start empty.',
            ),
        },
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
  }

  if (wants('emit_waypoints')) {
    server.registerTool(
      'emit_waypoints',
      {
        title: 'Emit waypoints',
        description:
          'Batch-create waypoints on the map (the feature must already be mapped — call ' +
          '`escalate_to_map` first). Returns each waypoint’s id, assigned `seq` and title. ' +
          'Available from any session once mapped: any session may branch the map.',
        inputSchema: {
          waypoints: z
            .array(WaypointInput)
            .min(1)
            .describe(
              'The whole batch, in the order you want them numbered. Each: title, type ' +
                '(grilling|research|prototype|task), question, blockedBy[]. `blockedBy` mixes ' +
                'TWO reference systems and the type tells them apart — a NUMBER is a 1-based ' +
                'position within THIS batch, a STRING is the id of an already-stored waypoint. ' +
                'Both resolve to global seq numbers on store.',
            ),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolEmitWaypoints(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('resolve_waypoint')) {
    server.registerTool(
      'resolve_waypoint',
      {
        title: 'Resolve waypoint',
        description:
          'End the current waypoint. Write the decision prose to decisions.md (or the gist to ' +
          'map.md Out-of-scope for a drop) FIRST — this tool flips machinery only. Returns the ' +
          'dependents it just freed and the frontier that remains, so you do not need another ' +
          'call to see what opened up. Call it exactly once, as the last thing you do.',
        inputSchema: {
          id: z.string().min(1).describe('The waypoint id — the one this session was opened on.'),
          disposition: WaypointDisposition.describe(
            '`resolved` when its question is answered; `dropped` when it is no longer needed. ' +
              'Both are terminal and both free dependents.',
          ),
          summary: z
            .string()
            .min(1)
            .describe('The one-line gist shown in the UI. Not the argument — that goes in the docs.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        const result = toolResolveWaypoint(rs.ctx, rs.session, args)
        await commitDocsCheckpoint(rs.ctx, rs.session, `runcastle: waypoint ${args.disposition}`)
        return ok(result)
      },
    )
  }

  if (wants('record_event')) {
    server.registerTool(
      'record_event',
      {
        title: 'Record event',
        description:
          'Add a note to the timeline the UI renders — the feature’s from a feature session, the ' +
          'project’s from a project-scoped one. For milestones (decisions recorded, spec saved), ' +
          'not for narration.',
        inputSchema: {
          type: EventType.describe(
            'A dotted `subject.verb` tag, lowercase (`decision.recorded`, `spec.saved`, ' +
              '`intake.note`, `research.completed`). Reuse an existing tag wherever one fits: ' +
              'the timeline is permanent and shared, and a vocabulary invented per session ' +
              'cannot be filtered on later.',
          ),
          message: z.string().min(1).describe('One human-readable line. The UI shows this verbatim.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolRecordEvent(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('complete_phase')) {
    server.registerTool(
      'complete_phase',
      {
        title: 'Complete phase',
        description:
          'Mark the named phase complete. Runs the gate check server-side and advances the ' +
          'feature, or returns { ok: false, reason, gate } naming what the gate wanted. On ' +
          'success it also returns `nextGate` — what the FOLLOWING gate requires — so the next ' +
          'step is not a guess. The tickets → implementation gate (G3) is the human "Burn" ' +
          'approval: completing the tickets phase records the work done and returns ' +
          '{ ok: true, nextPhase: "implementation", waitingOn: "human burn" } WITHOUT advancing.',
        inputSchema: {
          phase: CompletablePhase.describe(
            'The phase you are finishing — normally the feature’s current one. `shipped` is not ' +
              'completable by any session: a feature ships when the human merges it.',
          ),
        },
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
  }

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

/**
 * Who this request is, from its identity headers alone — resolved BEFORE the
 * server is assembled, because the tool list is part of the answer.
 *
 * Deliberately total: every path that cannot say for sure returns `undefined`,
 * which registers everything. A run header means a burner agent whatever the
 * run's state (a dead run's tools all refuse, which is the correct answer to a
 * stale header); a session header that resolves gives its kind; a request with
 * no headers at all falls back to the live singleton the same way tool calls do.
 */
export async function resolveAudience(
  sessionId: string | undefined,
  runId: string | undefined,
): Promise<McpAudience | undefined> {
  if (runId) return 'run'
  try {
    const ctx = await getRuntimeCtx()
    return resolveSession(ctx, sessionId)?.kind
  } catch {
    return undefined
  }
}

mcp.all('*', async (c) => {
  const audience = await resolveAudience(
    c.req.header('X-Runcastle-Session'),
    c.req.header(RUN_HEADER),
  )
  const server = buildMcpServer(audience)
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(c)
  return res ?? c.body(null, 202)
})

export default mcp
