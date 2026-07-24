import type { Feature } from '@runcastle/core'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { getRuntimeCtx } from '../launcher/runtime'
import {
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../launcher/sessions'
import { emit } from '../services/events'
import { tryGetFeature } from '../services/repo'
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

    const feature = tryGetFeature(ctx, session.featureId)
    if (!feature) return c.json({})

    switch (event) {
      case 'session-start':
        return c.json(handleSessionStart(ctx, sessionId, feature, body.payload))
      case 'user-prompt':
        return c.json(handleUserPrompt(ctx, feature))
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

function handleSessionStart(
  ctx: AppCtx,
  sessionId: string,
  feature: Feature,
  payload: Record<string, unknown> | undefined,
): unknown {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined

  markSessionLive(ctx, sessionId, { ccSessionId, transcriptPath })
  emit(ctx, feature.id, {
    type: 'session.started',
    message: 'session live',
    data: { sessionId, ccSessionId, transcriptPath },
  })

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionStartContext(ctx, feature),
    },
  }
}

function handleUserPrompt(ctx: AppCtx, feature: Feature): unknown {
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
