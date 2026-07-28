import type { Feature, SessionRow } from '@runcastle/core'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { getRuntimeCtx } from '../launcher/runtime'
import {
  getSessionRow,
  markSessionEnded,
  markSessionLive,
  noteKickoffPrompt,
} from '../launcher/sessions'
import { emit, emitForSession } from '../services/events'
import { keysToPrepare } from '../services/prep'
import { getProjectById, tryGetFeature } from '../services/repo'
import { listByFeature } from '../services/tickets'
import { releaseForSession } from '../services/waypoints'

/**
 * Hook receiver (SPEC §5.6): `POST /api/hooks/:event` for `session-start`,
 * `user-prompt` and `session-end`. The request body is what the standalone hook
 * client sends: `{ event, sessionId, payload }` (payload = the raw Claude Code
 * hook JSON). Responses are the verified hook JSON shapes from
 * docs/research/CC-INTEGRATION-NOTES.md §3 — Claude Code injects
 * `hookSpecificOutput.additionalContext` as session/turn context.
 *
 * Golden rule: an unknown session id, a missing feature, or ANY thrown error
 * returns `{}` — a hook must never break a live session.
 */
const hooks = new Hono()

// Declare the encoding of every JSON response explicitly. The bytes are always
// UTF-8 (JS strings → UTF-8 on serialize), but a bare `application/json` lets
// Latin-1/CP1252-defaulting HTTP clients (e.g. Windows PowerShell 5.1) misdecode
// em-dashes into `â€"` mojibake — the E2E's observed symptom. Cheap insurance.
hooks.use('*', async (c, next) => {
  await next()
  if (c.res.headers.get('content-type') === 'application/json') {
    c.res.headers.set('content-type', 'application/json; charset=utf-8')
  }
})

interface HookBody {
  event?: string
  sessionId?: string
  payload?: Record<string, unknown>
}

hooks.post('/:event', async (c) => {
  try {
    const event = c.req.param('event')
    const body = (await c.req.json().catch(() => ({}))) as HookBody
    const sessionId = body.sessionId
    if (!sessionId) return c.json({})

    const ctx = await getRuntimeCtx()
    const session = getSessionRow(ctx, sessionId)
    if (!session) return c.json({})

    // Project-scoped (`prepare`) sessions have no feature. They still need the
    // full lifecycle — `markSessionLive` is what flips the row live and lets the
    // kickoff be typed, so returning early here would leave the terminal open
    // and permanently silent — but none of the feature briefing applies.
    if (!session.featureId) {
      switch (event) {
        case 'session-start':
          return c.json(handlePrepareSessionStart(ctx, session, body.payload))
        case 'user-prompt':
          return c.json(handlePrepareUserPrompt(ctx, session, body.payload))
        case 'session-end':
          return c.json(handlePrepareSessionEnd(ctx, session))
        default:
          return c.json({})
      }
    }

    const feature = tryGetFeature(ctx, session.featureId)
    if (!feature) return c.json({})

    switch (event) {
      case 'session-start':
        return c.json(handleSessionStart(ctx, sessionId, feature, body.payload))
      case 'user-prompt':
        return c.json(handleUserPrompt(ctx, sessionId, feature, body.payload))
      case 'session-end':
        return c.json(handleSessionEnd(ctx, sessionId, feature))
      default:
        return c.json({})
    }
  } catch {
    // Never break the session on our account.
    return c.json({})
  }
})

/**
 * `SessionStart` — fired for EVERY source (`startup`, `resume`, `clear`,
 * `compact`, `fork`), since the settings register a matcher per source. Only the
 * first one flips the row to `live` and schedules the kickoff (`markSessionLive`
 * is idempotent); the later ones exist to keep `ccSessionId`/`transcript_path`
 * current — after a `/clear` or a compaction the conversation Claude Code would
 * `--resume` is a different one, and a stale id resumes the wrong transcript.
 */
function handleSessionStart(
  ctx: AppCtx,
  sessionId: string,
  feature: Feature,
  payload: Record<string, unknown> | undefined,
): unknown {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
  const source = typeof payload?.source === 'string' ? payload.source : undefined

  const wasLive = getSessionRow(ctx, sessionId)?.status === 'live'
  markSessionLive(ctx, sessionId, { ccSessionId, transcriptPath })
  if (!wasLive) {
    emit(ctx, feature.id, {
      type: 'session.started',
      message: source === 'resume' ? 'session live (conversation resumed)' : 'session live',
      data: { sessionId, ccSessionId, transcriptPath, source: source ?? null },
    })
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionStartContext(ctx, feature),
    },
  }
}

// --- project-scoped (`prepare`) session hooks --------------------------------

/**
 * `SessionStart` for a preparation conversation. Same lifecycle bookkeeping as
 * the feature path — flip live, keep `ccSessionId`/`transcript_path` current
 * across `/clear` and compaction — with a project brief instead of a feature
 * one. The digest re-grounds the agent on what is still unestablished, which is
 * exactly the state a compaction is most likely to have dropped.
 */
function handlePrepareSessionStart(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): unknown {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
  const source = typeof payload?.source === 'string' ? payload.source : undefined

  const wasLive = getSessionRow(ctx, session.id)?.status === 'live'
  markSessionLive(ctx, session.id, { ccSessionId, transcriptPath })
  if (!wasLive) {
    emitForSession(ctx, session, {
      type: 'session.started',
      message: source === 'resume' ? 'preparation session live (resumed)' : 'preparation session live',
      data: { sessionId: session.id, ccSessionId, transcriptPath, source: source ?? null },
    })
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: prepareStartContext(ctx, session),
    },
  }
}

function handlePrepareUserPrompt(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): unknown {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
  noteKickoffPrompt(ctx, session.id, prompt)
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[runcastle] preparation session (project-scoped, no feature)`,
    },
  }
}

function handlePrepareSessionEnd(ctx: AppCtx, session: SessionRow): unknown {
  markSessionEnded(ctx, session.id)
  emitForSession(ctx, session, {
    type: 'session.ended',
    message: 'preparation session ended',
    data: { sessionId: session.id },
  })
  return {}
}

/** What is still unestablished for this project, for the SessionStart digest. */
function prepareStartContext(ctx: AppCtx, session: SessionRow): string {
  const project = session.projectId ? getProjectById(ctx, session.projectId) : null
  if (!project) return '[runcastle] preparation session — project not found'
  const remaining = keysToPrepare(ctx, project)
  return [
    `[runcastle] preparation session for ${project.name} (${project.repoPath}).`,
    remaining.length > 0
      ? `Still unestablished: ${remaining.join(', ')}.`
      : 'Every prepared field currently has a value.',
    'Record what you establish with the `record_finding` MCP tool — a value the user',
    'gives you or confirms verbatim is theirs (userSupplied: true), anything you measured is not.',
  ].join(' ')
}

/**
 * `UserPromptSubmit` — the only proof a prompt actually reached Claude Code, so
 * it doubles as the kickoff delivery receipt (`noteKickoffPrompt`): our injected
 * briefing coming back here confirms it landed, and anything else means the
 * human typed first.
 */
function handleUserPrompt(
  ctx: AppCtx,
  sessionId: string,
  feature: Feature,
  payload: Record<string, unknown> | undefined,
): unknown {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
  noteKickoffPrompt(ctx, sessionId, prompt)
  const tickets = listByFeature(ctx, feature.id).length
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[runcastle] feature=${feature.slug} phase=${feature.phase} tickets=${tickets}`,
    },
  }
}

function handleSessionEnd(ctx: AppCtx, sessionId: string, feature: Feature): unknown {
  markSessionEnded(ctx, sessionId)
  // A waypoint session that ended without calling resolve_waypoint auto-releases
  // its waypoint back to the frontier (SPEC §13.2); no-op otherwise.
  releaseForSession(ctx, sessionId)
  emit(ctx, feature.id, {
    type: 'session.ended',
    message: 'session ended',
    data: { sessionId },
  })
  return {}
}

/** The SessionStart context digest: brief + phase + tickets + pointer to MCP. */
function sessionStartContext(ctx: AppCtx, feature: Feature): string {
  const tickets = listByFeature(ctx, feature.id)
  const byStatus = tickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})
  const ticketSummary =
    tickets.length === 0
      ? 'none yet'
      : `${tickets.length} (${Object.entries(byStatus)
          .map(([s, n]) => `${n} ${s}`)
          .join(', ')})`

  return [
    `[runcastle] ${feature.title} — ${feature.oneLiner}`,
    `phase: ${feature.phase}; branch: ${feature.branch}`,
    `docs: docs/features/${feature.slug}/ (brief.md, decisions.md, spec.md)`,
    `tickets: ${ticketSummary}`,
    'Call the runcastle MCP tool `get_feature_context` for the full docs + tickets.',
  ].join('\n')
}

export default hooks
