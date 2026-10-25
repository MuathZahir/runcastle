import { DEFAULT_RUNTIME, type Feature, type SessionKind, type SessionRow } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, projectWorktreesDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { type EditDenial, editDenyResponse, evaluateEditGuard, isUnguardedLead } from '../launcher/edit-guard'
import { evaluateInstallGuard } from '../launcher/install-guard'
import { evaluateLeadGuard } from '../launcher/lead-guard'
import { getRuntimeCtx } from '../launcher/runtime'
import { forgetUntouched } from '../launcher/untouched'
import {
  getSessionRow,
  markAgentWorking,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
} from '../launcher/sessions'
import { emit, emitForSession } from '../services/events'
import { mergeInProgressAt } from '../services/git'
import { featureStateLine } from '../services/feature-state'
import { isLiveLeadSession, leadDeliveryFor } from '../services/lead-delivery'
import { isRuncastlePrompt } from '../services/lead-prompt'
import { markHumanMessage } from '../services/lead-status'
import {
  hasOrchestratorLines,
  leadMessageKey,
  releaseOrchestratorWaiter,
  waitForOrchestratorLines,
} from '../services/orchestrator-messages'
import { keysToPrepare } from '../services/prep'
import { getProjectById, listRunsByFeature, tryGetFeature } from '../services/repo'
import { noteResolvedMerge, reconcileStandingConflict } from '../services/resolved-merge'
import { listByFeature } from '../services/tickets'

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

/** How long the orchestrator's message waiter is held before it polls again. */
export const ORCHESTRATOR_WAIT_HOLD_MS = 25_000

/**
 * The orchestrator's message waiter (`whole-cuts-plan-themselves` decision 20):
 * the long-poll its `asyncRewake` hook makes in the hook client's
 * `wait-messages` mode. Registering supersedes the session's older waiter, and
 * only the newest is ever handed lines (see `orchestrator-messages.ts`).
 *
 * A feature's lead with a terminal waits here too, for its feature's messages
 * (`the-feature-lead-runs-rounds` decision 12, see `lead-delivery.ts`). A
 * session that is gone, ended, or neither orchestrating nor a lead with a
 * terminal is answered `ended`, so its waiter exits instead of polling forever.
 */
hooks.get('/orchestrator-messages', async (c) => {
  try {
    const sessionId = c.req.query('sessionId')
    const waiter = c.req.query('waiter')
    if (!sessionId || !waiter) return c.json({ status: 'ended' })
    const ctx = await getRuntimeCtx()
    const session = getSessionRow(ctx, sessionId)
    const key = session && session.status !== 'ended' ? waiterKeyOf(session) : null
    if (!session || !key) return c.json({ status: 'ended' })
    const answer = await waitForOrchestratorLines(key, waiter, ORCHESTRATOR_WAIT_HOLD_MS)
    if (answer.status === 'lines' && session.featureId) {
      emit(ctx, session.featureId, {
        type: 'lead.woke',
        message: 'the agent took its messages at its turn end',
        data: { sessionId, route: 'waiter', lines: answer.lines.length },
      })
    }
    return c.json(answer)
  } catch (err) {
    console.error('orchestrator message waiter failed', err)
    return c.json({ status: 'empty' })
  }
})

/** The message-store key a session's waiter waits on, or null for a session that has none. */
function waiterKeyOf(session: SessionRow): string | null {
  if (session.purpose === 'orchestrate') return session.id
  if (isLiveLeadSession(session) && session.featureId) return leadMessageKey(session.featureId)
  return null
}

interface HookBody {
  event?: string
  sessionId?: string
  payload?: Record<string, unknown>
}

hooks.post('/:event', async (c) => {
  const event = c.req.param('event')
  let sessionId: string | undefined
  try {
    const body = (await c.req.json().catch(() => ({}))) as HookBody
    sessionId = body.sessionId
    if (!sessionId) return c.json({})

    const ctx = await getRuntimeCtx()
    const session = getSessionRow(ctx, sessionId)
    if (!session) return c.json({})

    // Turn state (decisions §3) — the same bit for every kind, feature-scoped or
    // not: a project conversation waits on its human exactly as a grill does.
    // `Stop` says nothing else, so it answers here; `user-prompt` carries on to
    // the per-scope handler for its injected context.
    if (event === 'user-prompt' || event === 'stop') checkInFromTurn(ctx, session, body.payload)
    if (event === 'user-prompt') {
      markAgentWorking(ctx, sessionId)
      // Any prompt, tagged runcastle's or the human's, keeps an auto-resumed
      // chat up: it has started a turn, so leaving it must not end it.
      forgetUntouched(sessionId)
    }
    if (event === 'stop') {
      markAwaitingInput(ctx, sessionId)
      // The turn that just ended may have committed a conflict's merge, and the
      // feature's one chat stays live after it — so ask git now, not at teardown.
      const feature = session.featureId ? tryGetFeature(ctx, session.featureId) : null
      if (feature) await reconcileStandingConflict(ctx, feature)
      return c.json({})
    }

    // Project-scoped sessions (`prepare` and `project` — see
    // PROJECT_SESSION_KINDS — and a `scenario` chat on a project drive) have no
    // feature. They still need the full
    // lifecycle — `markSessionLive` is what flips the row live and records the
    // id a later resume needs, so returning early here would strand the
    // conversation — but none of the feature briefing applies, and what they are
    // told instead differs per kind.
    if (!session.featureId) {
      switch (event) {
        case 'session-start':
          return c.json(handleProjectScopedSessionStart(ctx, session, body.payload))
        case 'user-prompt':
          return c.json(handleProjectScopedUserPrompt(session))
        case 'session-end':
          return c.json(handleProjectScopedSessionEnd(ctx, session, body.payload))
        case 'pre-tool':
          return c.json(await handlePreToolUse(ctx, session, undefined, body.payload))
        default:
          return c.json({})
      }
    }

    const feature = tryGetFeature(ctx, session.featureId)
    if (!feature) return c.json({})

    switch (event) {
      case 'session-start': {
        const answer = handleSessionStart(ctx, sessionId, feature, body.payload)
        kickLeadAtStart(ctx, sessionId)
        return c.json(answer)
      }
      case 'user-prompt':
        if (isLiveLeadSession(session)) handleLeadPrompt(ctx, feature, body.payload)
        return c.json(handleUserPrompt(ctx, feature, session))
      case 'session-end':
        return c.json(await handleSessionEnd(ctx, session, feature, body.payload))
      case 'pre-tool':
        return c.json(await handlePreToolUse(ctx, session, feature, body.payload))
      default:
        return c.json({})
    }
  } catch (err) {
    // Never break the session on our account — but never fail silently either.
    console.error(`hook ${event} failed for session ${sessionId ?? '(none)'}`, err)
    if (event === 'session-start' && sessionId) await noteFailedCheckIn(sessionId, err)
    return c.json({})
  }
})

/**
 * A `SessionStart` that threw left its session unchecked-in: the row stays
 * `launching`, and a headless wake's messages stay held against it. Say so on
 * the timeline, best effort — the failure may be the database itself — and
 * name the backstop: the agent's first turn hook checks it in
 * ({@link checkInFromTurn}).
 */
async function noteFailedCheckIn(sessionId: string, err: unknown): Promise<void> {
  try {
    const ctx = await getRuntimeCtx()
    const session = getSessionRow(ctx, sessionId)
    if (!session) return
    const reason = err instanceof Error ? err.message : String(err)
    emitForSession(ctx, session, {
      type: 'session.checkin_failed',
      message: `the agent started but runcastle could not record it (${reason}) — its first turn will check it in`,
      data: { sessionId, reason },
    })
  } catch (again) {
    console.error(`could not record the failed check-in of session ${sessionId}`, again)
  }
}

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

/**
 * A turn hook (`UserPromptSubmit`, `Stop`) carries the conversation's
 * `session_id` and `transcript_path` too, so it backs up `SessionStart`: a
 * session whose start hook never arrived (it timed out client-side on a slow
 * server moment) is checked in here, and an id a missed `/clear` start left
 * stale is brought current. Without it the row keeps no id, and the next resume
 * of the conversation (the lead's headless wake) has nothing to `--resume`. An
 * ended row stays ended; a row that already holds this id is left alone.
 */
function checkInFromTurn(ctx: AppCtx, session: SessionRow, payload: Record<string, unknown> | undefined): void {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  if (!ccSessionId || session.status === 'ended') return
  if (session.status === 'live' && session.ccSessionId === ccSessionId) return
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
  markSessionLive(ctx, session.id, { ccSessionId, transcriptPath })
  if (session.status === 'live') return
  emitForSession(ctx, session, {
    type: 'session.started',
    message: 'session live (checked in by its first turn — its start hook never arrived)',
    data: { sessionId: session.id, ccSessionId, transcriptPath, source: null },
  })
  kickLeadAtStart(ctx, session.id)
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

function handleProjectScopedUserPrompt(session: SessionRow): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: projectScopedPromptLabel(session.kind),
    },
  }
}

function handleProjectScopedSessionEnd(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): unknown {
  if (session.runtime === 'codex') {
    emitConversationEnded(ctx, session, payload)
    return {}
  }
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
    // Project-scoped only on a project drive; on a feature drive it takes the
    // feature path above.
    case 'scenario':
      return 'scenario chat'
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
 * `UserPromptSubmit` for a feature session: every turn is handed the feature's
 * current shape as context. The turn-state bit is flipped by the caller, for
 * every scope at once. A side session's label says so every turn
 * (several-sessions-per-feature): it is not the main chat, whatever it reads.
 */
function handleUserPrompt(ctx: AppCtx, feature: Feature, session: SessionRow): unknown {
  const tickets = listByFeature(ctx, feature.id).length
  const role = session.kind === 'side' ? ' role=side' : ''
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[runcastle] feature=${feature.slug} status=${featureStateLine(ctx, feature)} tickets=${tickets}${role}`,
    },
  }
}

/**
 * A lead's turn starts (`the-feature-lead-runs-rounds` decision 12, spec
 * "Stopping"). Its waiter is let go, lines kept, so a message arriving now waits
 * for the turn's end, where the Stop hook starts the next waiter. And a prompt
 * without runcastle's tag is one the human typed: it stamps the feature's
 * last-human-message mark. A payload with no prompt text says nothing about who
 * wrote it, so it stamps nothing.
 */
function handleLeadPrompt(ctx: AppCtx, feature: Feature, payload: Record<string, unknown> | undefined): void {
  releaseOrchestratorWaiter(leadMessageKey(feature.id), 'superseded')
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
  if (prompt !== undefined && !isRuncastlePrompt(prompt)) markHumanMessage(ctx, feature.id)
}

/**
 * A lead's session started: messages that queued while it was launching go now.
 * On Claude Code its own waiter starts with this hook and takes them; Codex has
 * a conversation id to `codex queue` to only from this point.
 */
function kickLeadAtStart(ctx: AppCtx, sessionId: string): void {
  const session = getSessionRow(ctx, sessionId)
  if (!session?.featureId || !isLiveLeadSession(session)) return
  const key = leadMessageKey(session.featureId)
  if (hasOrchestratorLines(key)) leadDeliveryFor(session).kick(session, key)
}

async function handleSessionEnd(
  ctx: AppCtx,
  session: SessionRow,
  feature: Feature,
  payload: Record<string, unknown> | undefined,
): Promise<unknown> {
  if (session.runtime === 'codex') {
    emitConversationEnded(ctx, session, payload)
    return {}
  }
  markSessionEnded(ctx, session.id)
  emit(ctx, feature.id, {
    type: 'session.ended',
    message: 'session ended',
    data: { sessionId: session.id },
  })
  await noteResolvedMerge(ctx, session, feature)
  return {}
}

function emitConversationEnded(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): void {
  const reason = typeof payload?.reason === 'string' ? payload.reason : 'unknown'
  emitForSession(ctx, session, {
    type: 'session.conversation_ended',
    message: `conversation ended (reason: ${reason})`,
    data: { sessionId: session.id, reason },
  })
}

/**
 * `PreToolUse` for the file-write and shell tools — the talk-session edit guard
 * (F2), the talk-worktree install guard ({@link evaluateInstallGuard}) and, for
 * a feature's chat or side session, the lead's line guard
 * ({@link evaluateLeadGuard}). A deny is returned as the verified hook shape.
 * Registered only for the kinds that may not write code (see `renderSettings` /
 * {@link evaluateEditGuard}).
 *
 * Anything allowed answers `{}`, "no opinion" — except for a feature's chat or
 * side session on Claude Code, which is answered `allow` (`the-feature-lead-runs-rounds`
 * decision 27; tickets-and-review-are-tools-not-phases decision 13): every feature
 * chat is the lead, and a prompt is a stall when the lead works while the human is away.
 * Codex never asks inside its sandbox, so its hook keeps answering `{}`.
 *
 * This is where the guard's one live input comes from: a `resolve-conflict`
 * session's worktree is asked whether its merge is still in progress, which is
 * what the exemption is scoped to. The probe never throws, so a session whose
 * worktree has gone missing is simply guarded as usual.
 */
async function handlePreToolUse(
  ctx: AppCtx,
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

  const denial =
    evaluateEditGuard({
      kind: session.kind,
      purpose: session.purpose,
      mergeInProgress,
      worktreePath: session.worktreePath,
      toolName,
      filePath: path,
      featureSlug: feature?.slug,
    }) ??
    evaluateInstallGuard({
      kind: session.kind,
      worktreePath: session.worktreePath,
      toolName,
      command: typeof toolInput.command === 'string' ? toolInput.command : undefined,
      talkWorktreePath:
        feature && feature.slug !== PROJECT_WORKTREE_SLUG
          ? worktreeDir(feature.projectId, feature.slug)
          : undefined,
    }) ??
    (feature && (session.kind === 'chat' || session.kind === 'side') ? leadGuardDenial(ctx, session, feature, toolName, toolInput) : null)
  if (denial) return editDenyResponse(denial)
  return feature && isUnguardedLead(session.kind) && (session.runtime ?? DEFAULT_RUNTIME) === 'claude-code'
    ? LEAD_ALLOW_RESPONSE
    : {}
}

/** The verified `PreToolUse` allow shape: skips the permission prompt. */
const LEAD_ALLOW_RESPONSE = {
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
}

/** The lead's line guard for a feature chat's shell call, fed from the project and feature rows. */
function leadGuardDenial(
  ctx: AppCtx,
  session: SessionRow,
  feature: Feature,
  toolName: string | undefined,
  toolInput: Record<string, unknown>,
): EditDenial | null {
  const project = getProjectById(ctx, feature.projectId)
  if (!project) return null
  return evaluateLeadGuard({
    toolName,
    command: typeof toolInput.command === 'string' ? toolInput.command : undefined,
    worktreePath: session.worktreePath,
    mainCheckout: project.repoPath,
    worktreesDir: projectWorktreesDir(feature.projectId),
    featureBranch: feature.branch,
    baseBranch: feature.baseBranch,
  })
}

/** The SessionStart context digest: brief + status + tickets + pointer to MCP. */
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
  // What the chat kickoff header carried too: a plain chat resume sends no
  // kickoff, so this is where the agent learns it on resume.
  const featureRuns = listRunsByFeature(ctx, feature.id)

  return [
    `[runcastle] ${feature.title} — ${feature.oneLiner}`,
    `status: ${featureStateLine(ctx, feature)}; branch: ${feature.branch}`,
    `docs: docs/features/${feature.slug}/ (brief.md, decisions.md, spec.md)`,
    `tickets: ${ticketSummary}`,
    `rounds run: ${featureRuns.length}; latest run: ${featureRuns[0]?.status ?? 'none'}`,
    'Call the runcastle MCP tool `get_feature_context` for the full docs + tickets.',
  ].join('\n')
}

export default hooks
