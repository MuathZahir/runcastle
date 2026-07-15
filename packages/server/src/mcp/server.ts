import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  Phase as PhaseT,
  SessionRow,
  Ticket,
  TicketInput as TicketInputT,
  Waypoint as WaypointT,
  WaypointInput as WaypointInputT,
} from '@runcastle/core'
import { Phase, TicketInput, WaypointDisposition, WaypointInput, nextGate, nextPhase } from '@runcastle/core'
import { Hono } from 'hono'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { GateError, isNotImplemented } from '../errors'
import { getRuntimeCtx } from '../launcher/runtime'
import { getSessionRow, mostRecentLiveSession } from '../launcher/sessions'
import { advance, escalateToMap } from '../services/features'
import { emit } from '../services/events'
import * as git from '../services/git'
import { listDocs, readDoc } from '../services/knowledge'
import { getFeatureRow } from '../services/repo'
import { listByFeature, storeTickets } from '../services/tickets'
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

function headerSessionId(extra: HeaderCarrier): string | undefined {
  const headers = extra.requestInfo?.headers
  if (!headers) return undefined
  const raw = headers['x-runcastle-session'] ?? headers['X-Runcastle-Session']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Resolve the session for a tool call: header first, else the live singleton. */
export function resolveSession(ctx: AppCtx, sessionId: string | undefined): SessionRow | null {
  if (sessionId) {
    const byId = getSessionRow(ctx, sessionId)
    if (byId) return byId
  }
  return mostRecentLiveSession(ctx)
}

// --- tool implementations (pure over AppCtx + session — unit-tested) ---------

export interface FeatureContext {
  feature: ReturnType<typeof getFeatureRow>
  phase: PhaseT
  docs: { relPath: string; content: string }[]
  tickets: Ticket[]
  /** Mapped features only (ADR-0001 §13.3): every waypoint on the map… */
  waypoints?: WaypointT[]
  /** …and the subset currently on the frontier (open, unclaimed, unblocked). */
  frontier?: WaypointT[]
  /** The waypoint THIS session claimed (kind=waypoint) — the one to work + resolve. */
  assignedWaypoint?: WaypointT
}

export function toolGetFeatureContext(ctx: AppCtx, session: SessionRow): FeatureContext {
  const feature = getFeatureRow(ctx, session.featureId)
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
    docs,
    tickets: listByFeature(ctx, feature.id),
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
  _session: SessionRow,
  input: { id: string; disposition: 'resolved' | 'dropped'; summary: string },
): { ok: true } {
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
  const feature = getFeatureRow(ctx, session.featureId)
  // `storeTickets` is the mutation and emits the single `tickets.stored` event
  // (one mutation → one event). This tool used to emit an additional
  // `tickets.emitted` note, which double-logged the same action on the timeline.
  const stored = storeTickets(ctx, feature.id, input.tickets)
  return { stored: stored.length, ids: stored.map((t) => t.id) }
}

export function toolEscalateToMap(
  ctx: AppCtx,
  session: SessionRow,
  input: { destination: string; notes?: string },
): { ok: true; warning?: string } {
  return escalateToMap(ctx, session.featureId, input)
}

export function toolEmitWaypoints(
  ctx: AppCtx,
  session: SessionRow,
  input: { waypoints: WaypointInputT[] },
): { stored: number; ids: string[] } {
  const feature = getFeatureRow(ctx, session.featureId)
  // Waypoints only exist on a map — every session on a mapped feature may branch
  // it (the recursion), but an unmapped feature must escalate first.
  if (!feature.mapped) {
    throw new GateError('feature is not mapped — call escalate_to_map before emitting waypoints')
  }
  const stored = storeWaypoints(ctx, feature.id, input.waypoints)
  return { stored: stored.length, ids: stored.map((w) => w.id) }
}

export function toolRecordEvent(
  ctx: AppCtx,
  session: SessionRow,
  input: { type: string; message: string },
): { ok: true } {
  emit(ctx, session.featureId, {
    type: input.type,
    message: input.message,
    data: { source: 'mcp' },
  })
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
  const feature = getFeatureRow(ctx, session.featureId)
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
    emit(ctx, session.featureId, {
      type: 'git.commit_pending',
      message: isNotImplemented(e)
        ? 'docs checkpoint skipped (git service pending)'
        : `docs checkpoint failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { message },
    })
  }
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

/** Build a fresh MCP server with the runcastle tools registered. */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'runcastle', version: '0.1.0' })

  server.registerTool(
    'get_feature_context',
    {
      title: 'Get feature context',
      description:
        'Full context for the current feature: the feature row, its phase, all docs/features/<slug>/*.md contents, and its tickets.',
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
        'Store the ideation session\'s ticket batch. Each ticket: title, goal, context, acceptanceCriteria[], seams[], blockedBy[] (1-based positions within THIS batch).',
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
      description: 'Add a note to the feature timeline (decisions recorded, spec saved, milestones).',
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

mcp.all('*', async (c) => {
  const server = buildMcpServer()
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(c)
  return res ?? c.body(null, 202)
})

export default mcp
