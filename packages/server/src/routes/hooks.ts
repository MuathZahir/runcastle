import { COMPACT_TEXT, DEFAULT_RUNTIME, type Feature, type Project, type SessionKind, type SessionRow } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, projectWorktreesDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import type { AppCtx } from '../db/types'
import { type EditDenial, editDenyResponse, evaluateEditGuard } from '../launcher/edit-guard'
import { evaluateCheckoutGuard, guardsCheckout, mentionsCommit } from '../launcher/checkout-guard'
import { evaluateInstallGuard } from '../launcher/install-guard'
import { evaluateLeadGuard } from '../launcher/lead-guard'
import { getRuntimeCtx } from '../launcher/runtime'
import { toolsForAudience } from '../mcp/server'
import { clearSentMemoryOnStart } from '../mcp/sent-memory'
import {
  getSessionRow,
  markAgentWorking,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
} from '../launcher/sessions'
import { emit, emitForSession } from '../services/events'
import { mergeInProgressAt, stagedPathsAt } from '../services/git'
import { featureStateLine } from '../services/feature-state'
import { isLeadSession } from '../services/lead-delivery'
import { isRuncastlePrompt } from '../services/lead-prompt'
import { markHumanMessage } from '../services/lead-status'
import { hasEverHadFeature, isEmptyRepo, keysToPrepare } from '../services/prep'
import { getProjectById, tryGetFeature } from '../services/repo'
import { noteResolvedMerge, reconcileStandingConflict } from '../services/resolved-merge'

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
    if (event === 'user-prompt') markAgentWorking(ctx, sessionId)
    if (event === 'stop') {
      markAwaitingInput(ctx, sessionId)
      // The turn that just ended may have committed a conflict's merge, and the
      // feature's one chat stays live after it — so ask git now, not at teardown.
      const feature = session.featureId ? tryGetFeature(ctx, session.featureId) : null
      if (feature) await reconcileStandingConflict(ctx, feature)
      return c.json({})
    }

    // Project-scoped sessions (`project` — see
    // PROJECT_SESSION_KINDS — and a `scenario` chat on a project drive) have no
    // feature. They still need the full
    // lifecycle — `markSessionLive` is what flips the row live and records the
    // id a later resume needs, so returning early here would strand the
    // conversation — but none of the feature briefing applies, and what they are
    // told instead differs per kind.
    if (!session.featureId) {
      switch (event) {
        case 'session-start':
          return c.json(await handleProjectScopedSessionStart(ctx, session, body.payload))
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
      case 'session-start':
        return c.json(handleSessionStart(ctx, sessionId, feature, body.payload))
      case 'user-prompt':
        if (isLeadSession(session)) handleLeadPrompt(ctx, feature, body.payload)
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
 * `launching`. Say so on
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

  // A conversation that lost its context no longer holds what read tools sent it.
  clearSentMemoryOnStart(sessionId, source)
  const wasLive = getSessionRow(ctx, sessionId)?.status === 'live'
  markSessionLive(ctx, sessionId, { ccSessionId, transcriptPath })
  if (!wasLive) {
    emit(ctx, feature.id, {
      type: 'session.started',
      message: source === 'resume' ? 'session live (conversation resumed)' : 'session live',
      data: { sessionId, ccSessionId, transcriptPath, source: source ?? null },
    })
  }

  const session = getSessionRow(ctx, sessionId)
  // After a compaction the agent holds only its own summary: it re-reads the
  // record before acting on it (lead-chats-stay-small decision 15).
  const context = sessionStartContext(ctx, feature, session)
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: source === 'compact' ? `${AFTER_COMPACTION}\n${context}` : context,
    },
  }
}

/** What a feature session's start context opens with when the start is a compaction's. */
export const AFTER_COMPACTION = 'Your context was just compacted. Before acting on the summary, call get_feature_context.'

/** What an orchestrator chat's start context opens with after a compaction (agents-are-woken-only-when-it-matters decision 26). */
export const ORCHESTRATOR_AFTER_COMPACTION =
  "Your context was just compacted. Before acting on the summary, call get_project_context and read the briefs of the features you hold: each carries its cut's working agreement."

/**
 * A turn hook (`UserPromptSubmit`, `Stop`) carries the conversation's
 * `session_id` and `transcript_path` too, so it backs up `SessionStart`: a
 * session whose start hook never arrived (it timed out client-side on a slow
 * server moment) is checked in here, and an id a missed `/clear` start left
 * stale is brought current. Without it the row keeps no id, and the next start
 * of the thread's process has no conversation to load. An
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
}

// --- project-scoped (`project`) session hooks --------------------------------

/**
 * `SessionStart` for a project-scoped conversation, either kind. Same lifecycle
 * bookkeeping as the feature path — flip live, keep `ccSessionId`/
 * `transcript_path` current across `/clear` and compaction — with a
 * kind-appropriate brief instead of a feature one. The bookkeeping is
 * kind-agnostic; only the injected context and the event wording are not.
 */
async function handleProjectScopedSessionStart(
  ctx: AppCtx,
  session: SessionRow,
  payload: Record<string, unknown> | undefined,
): Promise<unknown> {
  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
  const transcriptPath =
    typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
  const source = typeof payload?.source === 'string' ? payload.source : undefined

  const noun = projectScopedNoun(session.kind)
  clearSentMemoryOnStart(session.id, source)
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
      additionalContext:
        source === 'compact' && session.kind === 'project'
          ? `${ORCHESTRATOR_AFTER_COMPACTION}\n${await projectScopedStartContext(ctx, session)}`
          : await projectScopedStartContext(ctx, session),
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
 * injected labels. It matches what `launchProjectSession`
 * already emit at launch; an unrecognised featureless kind gets the neutral word
 * rather than being announced as somebody else's session.
 */
function projectScopedNoun(kind: SessionKind): string {
  switch (kind) {
    case 'project':
      return 'orchestrator'
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
  return `[runcastle] ${projectScopedNoun(kind)}`
}

/**
 * The `SessionStart` digest for a project-scoped session, per kind.
 *
 * A `project` session gets the facts its opening turns on (decision 3): which
 * keys are open, whether the repo is empty, whether the project has ever had a
 * feature. Facts, not an agenda — handing it a bare "still unestablished" list
 * once made it open by measuring setup commands on a project already in use.
 * What it does with them is its skill's §0 rule: only a new project with code
 * and open keys is prepared first; one in use gets a one-line offer.
 */
async function projectScopedStartContext(ctx: AppCtx, session: SessionRow): Promise<string> {
  const noun = projectScopedNoun(session.kind)
  const project = session.projectId ? getProjectById(ctx, session.projectId) : null
  if (!project) return `[runcastle] ${noun} — project not found`

  const scope = `[runcastle] ${noun} for ${project.name} (${project.repoPath})`
  const lines = [session.kind === 'project' ? `${scope}.\n${await orchestratorPrepNote(ctx, project)}` : scope]
  return [...lines, ...toolLoadLine(session)].join('\n')
}

/**
 * The orchestrator's preparation facts, one per line, closed by the opening
 * they add up to under the `runcastle:project` skill's §0 rule. A repo that
 * cannot be read is reported as having code: the orchestrator finds out the
 * rest by looking, which is what preparing starts with anyway.
 */
async function orchestratorPrepNote(ctx: AppCtx, project: Project): Promise<string> {
  const open = keysToPrepare(ctx, project)
  const empty = await isEmptyRepo(project.repoPath).catch(() => false)
  const hadFeature = hasEverHadFeature(ctx, project.id)

  const opening =
    empty || open.length === 0
      ? 'open as usual'
      : hadFeature
        ? 'open as usual, with one line offering to set up the open keys'
        : 'prepare first — read references/preparation.md, talk to them about their app in plain words, then ask what they want to build'
  return [
    `Open prepared keys: ${open.length > 0 ? open.join(', ') : 'none'}.`,
    `Repo: ${empty ? 'empty' : 'has code'}.`,
    `Features: ${hadFeature ? 'this project has had features' : 'none ever'}.`,
    `Opening (your skill's §0): ${opening}.`,
  ].join('\n')
}

/**
 * `UserPromptSubmit` for a feature session: every turn is handed the feature's
 * current shape as context. The turn-state bit is flipped by the caller, for
 * every scope at once. A side session's label says so every turn
 * (several-sessions-per-feature): it is not the main chat, whatever it reads.
 */
function handleUserPrompt(ctx: AppCtx, feature: Feature, session: SessionRow): unknown {
  const role = session.kind === 'side' ? ' role=side' : ''
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[runcastle] feature=${feature.slug} status=${featureStateLine(ctx, feature)}${role}`,
    },
  }
}

/**
 * A lead's turn starts (`the-feature-lead-runs-rounds` decision 12, spec
 * "Stopping"). A prompt without runcastle's tag is one the human typed — into
 * the thread's composer, which sends it as it was written — so it stamps the
 * feature's last-human-message mark. A payload with no prompt text says
 * nothing about who wrote it, so it stamps nothing. Nor does the compaction
 * command: runcastle sends it, and stamping it would clear what the feature
 * waits on (lead-chats-stay-small decision 14).
 */
function handleLeadPrompt(ctx: AppCtx, feature: Feature, payload: Record<string, unknown> | undefined): void {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
  if (prompt === undefined || isRuncastlePrompt(prompt) || COMPACT_TEXT.test(prompt.trimStart())) return
  markHumanMessage(ctx, feature.id, { typed: true })
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
 * A host-side session's shell call also meets the checkout guard
 * ({@link evaluateCheckoutGuard}).
 *
 * Anything allowed answers `{}`, "no opinion": every Claude session runs in
 * `bypassPermissions`, so no `allow` answer is needed to skip a prompt, and a
 * hook `allow` would not override the human's own `ask` rules anyway.
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
    (feature && (session.kind === 'chat' || session.kind === 'side') ? leadGuardDenial(ctx, session, feature, toolName, toolInput) : null) ??
    (await checkoutGuardDenial(session, toolName, toolInput))
  return denial ? editDenyResponse(denial) : {}
}

/**
 * The checkout guard for a host-side session's shell call. The staged paths are
 * git IO, probed only when the command contains a `git commit`.
 */
async function checkoutGuardDenial(
  session: SessionRow,
  toolName: string | undefined,
  toolInput: Record<string, unknown>,
): Promise<EditDenial | null> {
  if (!guardsCheckout(session.kind)) return null
  const command = typeof toolInput.command === 'string' ? toolInput.command : undefined
  const stagedPaths = command && mentionsCommit(command) ? await stagedPathsAt(session.worktreePath) : undefined
  return evaluateCheckoutGuard({
    kind: session.kind,
    purpose: session.purpose,
    toolName,
    command,
    worktreePath: session.worktreePath,
    stagedPaths,
  })
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

/** The SessionStart context digest: brief + status + pointer to MCP. */
function sessionStartContext(ctx: AppCtx, feature: Feature, session: SessionRow | null): string {
  return [
    `[runcastle] ${feature.title} — ${feature.oneLiner}`,
    `status: ${featureStateLine(ctx, feature)}; branch: ${feature.branch}`,
    `docs: docs/features/${feature.slug}/ (brief.md, decisions.md, spec.md)`,
    'A repeat `get_feature_context` returns only what changed; `read_feature_doc` returns any doc in full.',
    ...toolLoadLine(session),
  ].join('\n')
}

/**
 * The one line that loads every runcastle tool a Claude Code session is offered
 * in a single ToolSearch, so it never loads them one at a time. Codex has no
 * ToolSearch, so it gets none.
 */
function toolLoadLine(session: SessionRow | null): string[] {
  if (!session || (session.runtime ?? DEFAULT_RUNTIME) !== 'claude-code') return []
  const tools = toolsForAudience(session.kind).map((name) => `mcp__runcastle__${name}`)
  return [`Load your runcastle tools once: ToolSearch "select:${tools.join(',')}"`]
}

export default hooks
