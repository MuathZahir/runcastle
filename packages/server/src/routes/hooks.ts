import type { Feature, SessionKind, SessionRow } from '@runcastle/core'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { editDenyResponse, evaluateEditGuard } from '../launcher/edit-guard'
import { getRuntimeCtx } from '../launcher/runtime'
import {
  getSessionRow,
  markAgentWorking,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
  noteKickoffPrompt,
} from '../launcher/sessions'
import { emit, emitForSession } from '../services/events'
import { mergeInProgressAt } from '../services/git'
import { keysToPrepare } from '../services/prep'
import { getProjectById, tryGetFeature } from '../services/repo'
import { listByFeature } from '../services/tickets'
import { releaseForSession } from '../services/waypoints'

/**
 * Hook receiver (SPEC §5.6): `POST /api/hooks/:event` for `session-start`,
 * `user-prompt`, `stop` and `session-end`. The request body is what the
 * standalone hook client sends: `{ event, sessionId, payload }` (payload = the
 * raw Claude Code hook JSON). Responses are the verified hook JSON shapes from
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

    // Turn state (decisions §3) — the same bit for every kind, feature-scoped or
    // not: a project conversation waits on its human exactly as a grill does.
    // `Stop` says nothing else, so it answers here; `user-prompt` carries on to
    // the per-scope handler for its injected context.
    if (event === 'user-prompt') markAgentWorking(ctx, sessionId)
    if (event === 'stop') {
      markAwaitingInput(ctx, sessionId)
      return c.json({})
    }

    // Project-scoped sessions (`prepare` and `project` — see
    // PROJECT_SESSION_KINDS) have no feature. They still need the full
    // lifecycle — `markSessionLive` is what flips the row live and lets the
    // kickoff be typed, so returning early here would leave the terminal open
    // and permanently silent — but none of the feature briefing applies, and
    // what they are told instead differs per kind.
    if (!session.featureId) {
      switch (event) {
        case 'session-start':
          return c.json(handleProjectScopedSessionStart(ctx, session, body.payload))
        case 'user-prompt':
          return c.json(handleProjectScopedUserPrompt(ctx, session, body.payload))
        case 'session-end':
          return c.json(handleProjectScopedSessionEnd(ctx, session))
        case 'pre-tool':
          return c.json(await handlePreToolUse(session, undefined, body.payload))
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
      case 'pre-tool':
        return c.json(await handlePreToolUse(session, feature, body.payload))
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

// --- project-scoped (`prepare` / `project`) session hooks --------------------

/**
 * `SessionStart` for a project-scoped conversation, either kind. Same lifecycle
 * bookkeeping as the feature path — flip live, keep `ccSessionId`/
 * `transcript_path` current across `/clear` and compaction — with a
 * kind-appropriate brief instead of a feature one. The bookkeeping is
 * kind-agnostic; only the injected context and the event wording are not.
 */
function handleProjectScopedSessionStart(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): unknown {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
  const source = typeof payload?.source === 'string' ? payload.source : undefined

  const noun = projectScopedNoun(session.kind)
  const wasLive = getSessionRow(ctx, session.id)?.status === 'live'
  markSessionLive(ctx, session.id, { ccSessionId, transcriptPath })
  if (!wasLive) {
    emitForSession(ctx, session, {
      type: 'session.started',
      message: source === 'resume' ? `${noun} live (resumed)` : `${noun} live`,
      data: { sessionId: session.id, ccSessionId, transcriptPath, source: source ?? null },
    })
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: projectScopedStartContext(ctx, session),
    },
  }
}

function handleProjectScopedUserPrompt(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): unknown {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
  noteKickoffPrompt(ctx, session.id, prompt)
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: projectScopedPromptLabel(session.kind),
    },
  }
}

function handleProjectScopedSessionEnd(ctx: AppCtx, session: SessionRow): unknown {
  markSessionEnded(ctx, session.id)
  emitForSession(ctx, session, {
    type: 'session.ended',
    message: `${projectScopedNoun(session.kind)} ended`,
    data: { sessionId: session.id },
  })
  return {}
}

/**
 * The human noun for a project-scoped session, used in its lifecycle events and
 * injected labels. It matches what `launchPrepareSession`/`launchProjectSession`
 * already emit at launch; an unrecognised featureless kind gets the neutral word
 * rather than being announced as somebody else's session.
 */
function projectScopedNoun(kind: SessionKind): string {
  switch (kind) {
    case 'prepare':
      return 'preparation session'
    case 'project':
      return 'project session'
    default:
      return 'session'
  }
}

/** The per-turn `UserPromptSubmit` label for a project-scoped session, per kind. */
function projectScopedPromptLabel(kind: SessionKind): string {
  return kind === 'prepare'
    ? '[runcastle] preparation session (project-scoped, no feature)'
    : `[runcastle] ${projectScopedNoun(kind)}`
}

/**
 * The `SessionStart` digest for a project-scoped session, per kind.
 *
 * Only `prepare` gets the preparation agenda: its whole job is closing the
 * unestablished keys, and the digest re-grounds it on which are still open —
 * exactly the state a compaction is most likely to have dropped. A `project`
 * session gets its scope and nothing else; its real briefing is the injected
 * system prompt (`renderProjectPrompt`), and handing it the prep agenda made it
 * open by measuring setup commands instead of talking to the human.
 */
function projectScopedStartContext(ctx: AppCtx, session: SessionRow): string {
  const noun = projectScopedNoun(session.kind)
  const project = session.projectId ? getProjectById(ctx, session.projectId) : null
  if (!project) return `[runcastle] ${noun} — project not found`

  const scope = `[runcastle] ${noun} for ${project.name} (${project.repoPath})`
  if (session.kind !== 'prepare') return scope

  const remaining = keysToPrepare(ctx, project)
  return [
    `${scope}.`,
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

/**
 * `PreToolUse` for the file-write tools — the talk-session edit guard (F2). A
 * deny is returned as the verified hook shape; anything allowed answers `{}`,
 * which Claude Code reads as "no opinion". Registered only for the kinds that
 * may not write code (see `renderSettings` / {@link evaluateEditGuard}).
 *
 * This is where the guard's one live input comes from: a `resolve-conflict`
 * session's worktree is asked whether its merge is still in progress, which is
 * what the exemption is scoped to. The probe never throws, so a session whose
 * worktree has gone missing is simply guarded as usual.
 */
async function handlePreToolUse(
  session: SessionRow,
  feature: Feature | undefined,
  payload: Record<string, unknown> | undefined,
): Promise<unknown> {
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : undefined
  const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>
  const path =
    typeof toolInput.file_path === 'string'
      ? toolInput.file_path
      : typeof toolInput.notebook_path === 'string'
        ? toolInput.notebook_path
        : undefined

  // Only a resolve-conflict session can spend the exemption, so only it pays for
  // the git probe — every other session keeps the pure, IO-free path it had.
  const mergeInProgress =
    session.purpose === 'resolve-conflict' ? await mergeInProgressAt(session.worktreePath) : false

  const denial = evaluateEditGuard({
    kind: session.kind,
    purpose: session.purpose,
    mergeInProgress,
    worktreePath: session.worktreePath,
    toolName,
    filePath: path,
    featureSlug: feature?.slug,
  })
  return denial ? editDenyResponse(denial) : {}
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
    // The lap is part of where the feature IS (ADR-0010): a session that only
    // hears "phase: ideation" on a lap-2 feature reads it as the first grill and
    // re-litigates decisions the previous lap already shipped.
    `phase: ${feature.phase}; lap: ${feature.lap}; branch: ${feature.branch}`,
    `docs: docs/features/${feature.slug}/ (brief.md, decisions.md, spec.md)`,
    `tickets: ${ticketSummary}`,
    'Call the runcastle MCP tool `get_feature_context` for the full docs + tickets.',
  ].join('\n')
}

export default hooks
