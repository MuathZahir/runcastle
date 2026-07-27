import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, Project, Run, SessionKind, SessionRow, Waypoint } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { nextGate, nextPhase, resolveModel } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { resolveTool, spawnTargetFor, type SpawnTarget } from '../util/resolve-executable'
import { SKILLS_DIR_ENV } from './skills-root'
import { runs } from '../db/schema'
import { GateError, isNotImplemented } from '../errors'
import { ptyRegistry } from '../pty/registry'
import { emit } from '../services/events'
import { checkGate, overrideGate } from '../services/gates'
import * as git from '../services/git'
import { getFeatureRow, projectForFeature, rowToRun, setPhase } from '../services/repo'
import { listByFeature as listTicketsByFeature } from '../services/tickets'
import {
  claim as claimWaypoint,
  getWaypoint,
  releaseForSession,
} from '../services/waypoints'
import { startRun, workflowClaimsFeatureBranch } from '../workflows/runner'
import { serverUrlFor, writeSessionArtifacts } from './artifacts'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  mostRecentResumableSession,
  resumeKickoffLine,
  setKickoffOverride,
} from './sessions'

// Re-exported so the `feature.endSession` router (W2) imports the real,
// PTY-killing service from `../../launcher/launcher` per its coordination note —
// the implementation lives in the PTY layer (`pty/end-session`).
export { endSession, type EndSessionResult } from '../pty/end-session'

/**
 * Session launcher (SPEC §5 / UI-SPEC §5). Spawns a real, injected Claude Code
 * session inside a server-owned embedded PTY: creates the session row, ensures
 * the talk worktree, writes the launch artifacts, then spawns `claude` with our
 * settings/mcp/plugin flags and the two runcastle env vars inherited directly
 * onto the spawn. The PTY is registered by session id and streamed to the in-app
 * xterm view over `/ws/terminal/:sessionId` (cross-platform; no `wt.exe`).
 */

/**
 * Human-readable `session.pty_exited` message. The backend hands us a numeric
 * exit code (`{ exitCode }` from the native/sidecar PTY, sourced from node-pty's
 * `onExit` / the sidecar's `{ t:'exit', code }` frame). If a code is genuinely
 * absent (e.g. a host that died without reporting one), render `unknown` rather
 * than the literal string `undefined`.
 */
export function ptyExitMessage(exitCode: number | undefined | null): string {
  const label = typeof exitCode === 'number' ? String(exitCode) : 'unknown'
  return `terminal exited (code ${label})`
}

export interface LaunchSessionInput {
  featureId: string
  kind: SessionKind
  /**
   * When set, claim this waypoint for the freshly-created session BEFORE spawning
   * (kind=waypoint sessions). The claim re-checks the frontier transactionally
   * and throws if the waypoint is no longer claimable; the session row is then
   * marked ended and the error propagates, so no orphaned session lingers.
   */
  waypointId?: string
  /**
   * Optional kickoff line, replacing the per-kind default typed into the PTY once
   * the session goes live (`KICKOFF_LINES`). Callers pass a per-purpose briefing
   * here — e.g. a revisit told to resolve a merge conflict or iterate on review.
   */
  kickoffLine?: string
}

export interface LaunchSessionOptions {
  /**
   * Spawn the embedded PTY (default true). Set false to fabricate a session
   * end-to-end MINUS the process — the row, talk worktree and launch artifacts
   * are all created for real; only the PTY spawn is skipped. Used by the scripted
   * smoke (SPEC §11) so it can drive hooks/MCP against a real live session
   * without a live terminal.
   */
  spawn?: boolean
}

export interface LaunchSessionResult {
  sessionId: string
}

/** Working a research waypoint starts a headless run instead of a session. */
export interface WorkRunResult {
  runId: string
}

export interface BuildLaunchInput {
  sessionId: string
  serverUrl: string
  featureTitle: string
  worktreePath: string
  pluginDir: string
  settingsPath: string
  mcpConfigPath: string
  systemPromptPath: string
  permissionMode?: string
  /**
   * The model this embedded session runs (`--model`), resolved for the session
   * kind's step via `resolveModel` (issue #48) — sessions must honour the
   * configured model, never the operator's global CLI default (E2E finding: the
   * model flag was missing).
   */
  model: string
  /**
   * The Claude Code session id (`ccSessionId`) to `--resume`. Every kind has a
   * resume target: a waypoint resumes the conversation its `lastSessionId`
   * remembers, a revisit resumes the feature's latest conversation of any kind,
   * and every other kind resumes its own latest conversation (so reopening a
   * terminal after runcastle restarts continues it). `--resume` is scoped to the
   * project dir + its worktrees (CC-INTEGRATION-NOTES §7), which the talk worktree
   * satisfies. Omitted → a fresh session.
   */
  resumeSessionId?: string
}

/**
 * The `claude` argv AFTER the program name (UI-SPEC §5.3). `launchSession`
 * passes it verbatim to the embedded PTY spawn, and the `spawn:false` smoke path
 * renders it for its `session.launched` event, so the flags/artifacts never
 * drift. `--append-system-prompt-file` is a verified flag (CC-INTEGRATION-NOTES §7).
 */
export function buildClaudeArgs(input: BuildLaunchInput): string[] {
  const permissionMode = input.permissionMode ?? 'acceptEdits'
  const resume = input.resumeSessionId ? ['--resume', input.resumeSessionId] : []
  return [
    ...resume,
    '--settings',
    input.settingsPath,
    '--mcp-config',
    input.mcpConfigPath,
    '--strict-mcp-config',
    '--plugin-dir',
    input.pluginDir,
    '--append-system-prompt-file',
    input.systemPromptPath,
    '--permission-mode',
    permissionMode,
    '--model',
    input.model,
  ]
}

/**
 * Resolve the `claude` executable to an absolute path. `RUNCASTLE_CLAUDE_BIN`
 * overrides; otherwise PATH is scanned for `claude` with Windows extensions.
 * Falls back to the bare name so `CreateProcess`/exec can make a final attempt.
 */
function resolveClaudeExecutable(): string {
  return resolveTool('claude')
}

/**
 * The `{file, args}` to spawn `claude` inside a PTY. A native `.exe` is spawned
 * directly; a `.cmd`/`.bat`/`.ps1` shim goes through its interpreter (ConPTY
 * cannot exec any of them directly) — see {@link spawnTargetFor}. Env is
 * inherited on the spawn (UI-SPEC §5 — no `cmd /k` env prefix, no `wt.exe`).
 */
function claudeSpawnTarget(claudeArgs: string[]): SpawnTarget {
  return spawnTargetFor(resolveClaudeExecutable(), claudeArgs)
}

/**
 * Resolve the `runcastle` plugin dir (`packages/skills/packs/runcastle`).
 * Ascends from `fromDir` looking for the marker dir (robust against the server
 * being run from anywhere). If no ancestor contains it, throws an error naming
 * every location searched — never a silent fallback to a path that doesn't
 * exist (a missing pack must surface loudly, not fail later at launch time).
 */
export function resolvePluginDir(
  fromDir: string = dirname(fileURLToPath(import.meta.url)),
): string {
  const rel = join('packages', 'skills', 'packs', 'runcastle')

  // Published install: skills are vendored as real files and RUNCASTLE_SKILLS_DIR
  // names their root — read the pack straight from there (issue #51). A bad
  // override throws loudly rather than silently falling back to a workspace path.
  const override = process.env[SKILLS_DIR_ENV]
  if (override) {
    const dir = join(resolve(override), 'packs', 'runcastle')
    if (existsSync(dir)) return dir
    throw new Error(`${SKILLS_DIR_ENV}=${override} has no plugin dir at ${dir}`)
  }

  const searched: string[] = []
  let dir = fromDir
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, rel)
    searched.push(candidate)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `runcastle plugin dir (${rel}) not found; searched:\n  ${searched.join('\n  ')}`,
  )
}

/**
 * The feature's currently-running AFK run, if any. Spawning an HITL terminal
 * is refused only while a BRANCH-CLAIMING run (e.g. ticket-burner) is in
 * flight: the runner detaches the talk worktree for those, so a session
 * spawned mid-run would land on a detached HEAD and orphan its docs commits.
 * Research runs work on temp branches (ADR-0001 §7 "parallel AFK") and never
 * block terminals; run-claims themselves never block anything.
 */
function activeRunFor(ctx: AppCtx, featureId: string): Run | null {
  const row = ctx.db
    .select()
    .from(runs)
    .where(and(eq(runs.featureId, featureId), eq(runs.status, 'running')))
    .limit(1)
    .get()
  return row ? rowToRun(row) : null
}

/**
 * Throw when an HITL session must not spawn on this feature right now:
 * - another session row is `launching`/`live` (one live HITL session per feature
 *   — one talk worktree, git forbids two checkouts of one branch). Guarding on
 *   session ROWS, not waypoint claims, means resolving a waypoint while its
 *   terminal is still open can no longer sneak a second live session in.
 * - an AFK run is in progress (see `activeRunFor` — worktree detached).
 * `excludeSessionId` skips the caller's own just-created row.
 */
function assertSpawnable(ctx: AppCtx, feature: Feature, excludeSessionId?: string): void {
  const live = activeSessionsForFeature(ctx, feature.id).filter((s) => s.id !== excludeSessionId)
  if (live.length > 0) {
    throw new GateError(
      `a ${live[0].kind} session is already live for ${feature.slug} — only one terminal per feature; end or resume it first`,
    )
  }
  const running = activeRunFor(ctx, feature.id)
  if (running && workflowClaimsFeatureBranch(running.workflow)) {
    throw new GateError(
      `a ${running.workflow} run is in progress on ${feature.slug} — it holds the feature branch; terminals are available when it finishes`,
    )
  }
}

/** Ensure the talk worktree, tolerating B2's stub (mirrors features.createFeature). */
async function ensureWorktree(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<string> {
  try {
    return await git.ensureTalkWorktree(project, feature)
  } catch (e) {
    if (isNotImplemented(e)) {
      const fallback = worktreeDir(project.id, feature.slug)
      emit(ctx, feature.id, {
        type: 'session.worktree_pending',
        message: 'talk worktree not created (git service pending) — using computed path',
        data: { worktreePath: fallback },
      })
      return fallback
    }
    throw e
  }
}

export async function launchSession(
  ctx: AppCtx,
  input: LaunchSessionInput,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  const project = projectForFeature(ctx, feature)

  const worktreePath = await ensureWorktree(ctx, project, feature)
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: input.kind,
    worktreePath,
  })

  // A waypoint session claims its waypoint BEFORE spawning (SPEC §13.2). The
  // prior LIVE session's cc id (`lastSessionId` — promoted only when a session
  // actually started) is captured so a released-then-reworked waypoint resumes
  // the same conversation. A failed claim (no longer on the frontier) ends the
  // just-created session row and rethrows.
  let waypoint: Waypoint | undefined
  let resumeSessionId: string | undefined
  let resumeUnavailableFrom: string | undefined
  if (input.waypointId) {
    const before = getWaypoint(ctx, input.waypointId)
    if (before.lastSessionId) {
      resumeSessionId = getSessionRow(ctx, before.lastSessionId)?.ccSessionId ?? undefined
      // No cc id recorded for the remembered session → nothing the CLI could
      // `--resume`. Spawn fresh WITHOUT the flag (a bogus --resume makes claude
      // exit with "No conversation found") and say so on the timeline.
      if (!resumeSessionId) resumeUnavailableFrom = before.lastSessionId
    }
    try {
      // Re-check the one-live-session guard here, synchronously adjacent to the
      // claim itself (no `await` between the two). `workWaypoint` already checks
      // up front, but that check runs before this function's `await
      // ensureWorktree` above — leaving a window where two concurrent Work calls
      // on two DIFFERENT waypoints of the same feature both pass it before
      // either claims. This recheck is the race-free, authoritative gate. It
      // guards on live session ROWS (not claims), so a resolved-but-still-open
      // terminal blocks a second spawn too (E2E finding 8).
      assertSpawnable(ctx, feature, session.id)
      waypoint = claimWaypoint(ctx, input.waypointId, session.id)
    } catch (e) {
      markSessionEnded(ctx, session.id)
      throw e
    }
  }

  // A revisit resumes the feature's most recent resumable conversation (SPEC:
  // "I remembered something"). One-live-session guard first — same failure mode
  // as the waypoint path (end the just-created row, rethrow). No resumable
  // conversation is fine: the docs carry the state, so it starts fresh and the
  // timeline says so.
  if (input.kind === 'revisit') {
    try {
      assertSpawnable(ctx, feature, session.id)
    } catch (e) {
      markSessionEnded(ctx, session.id)
      throw e
    }
    const prior = mostRecentResumableSession(ctx, feature.id)
    if (prior?.ccSessionId) {
      resumeSessionId = prior.ccSessionId
    } else {
      resumeUnavailableFrom = 'revisit'
    }
  }

  // Every OTHER kind (ideation / qa / converge) resumes its own most recent
  // conversation on this feature. A terminal is a real `claude` process in a
  // server-owned PTY, so quitting runcastle kills it and boot reconciliation
  // marks the row ended — but the Claude Code transcript survives on disk and
  // the row kept its `ccSessionId`, so reopening the same kind of terminal picks
  // the conversation back up instead of starting cold from the docs. No prior
  // conversation is the ordinary first-launch case, so unlike waypoint/revisit
  // it gets no `resume_unavailable` note — there is nothing to be unavailable.
  if (input.kind !== 'waypoint' && input.kind !== 'revisit') {
    resumeSessionId = mostRecentResumableSession(ctx, feature.id, input.kind)?.ccSessionId
  }

  // Stash the kickoff override BEFORE the session can go live — the kickoff is
  // scheduled from `markSessionLive` (fired by the SessionStart hook), so it must
  // be registered against the session id ahead of it. An explicit per-purpose
  // briefing always wins; otherwise a resumed session gets the resume framing so
  // the agent continues the conversation rather than restarting its opening move.
  const kickoffLine =
    input.kickoffLine ?? (resumeSessionId ? resumeKickoffLine(input.kind) : undefined)
  if (kickoffLine) setKickoffOverride(session.id, kickoffLine)

  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching ${input.kind} session`,
    data: { sessionId: session.id, kind: input.kind, worktreePath, waypointId: waypoint?.id },
  })

  if (resumeSessionId) {
    emit(ctx, feature.id, {
      type: 'session.resumed',
      message: `resuming the previous ${input.kind} conversation`,
      data: { sessionId: session.id, kind: input.kind, resumeSessionId },
    })
  }

  if (input.kind === 'revisit' && resumeUnavailableFrom) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: 'no resumable conversation for this feature — revisiting fresh from the docs',
      data: { sessionId: session.id },
    })
  }

  if (waypoint && resumeUnavailableFrom) {
    emit(ctx, feature.id, {
      type: 'session.resume_unavailable',
      message: `waypoint ${waypoint.seq} has no resumable conversation — starting fresh`,
      data: { sessionId: session.id, waypointId: waypoint.id, lastSessionId: resumeUnavailableFrom },
    })
  }

  const artifacts = await writeSessionArtifacts({
    session,
    feature,
    project,
    config: ctx.config,
    waypoint,
  })
  const serverUrl = serverUrlFor(ctx.config)

  const buildInput: BuildLaunchInput = {
    sessionId: session.id,
    serverUrl,
    featureTitle: feature.title,
    worktreePath,
    pluginDir: resolvePluginDir(),
    settingsPath: artifacts.settingsPath,
    mcpConfigPath: artifacts.mcpConfigPath,
    systemPromptPath: artifacts.systemPromptPath,
    // The session kind IS a model step (issue #48): resolve per-step model,
    // falling back through the per-project override to the global default.
    model: resolveModel(input.kind, ctx.config, project),
    resumeSessionId,
  }

  // spawn:false fabricates a session MINUS any process (SPEC §11 smoke driver).
  if (opts.spawn === false) {
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'session prepared (terminal spawn skipped)',
      data: {
        sessionId: session.id,
        command: ['claude', ...buildClaudeArgs(buildInput)].join(' '),
        spawned: false,
      },
    })
    return { sessionId: session.id }
  }

  spawnEmbeddedPty(ctx, feature, session, worktreePath, serverUrl, buildClaudeArgs(buildInput), {
    waypoint,
    resumeSessionId,
  })
  return { sessionId: session.id }
}

/**
 * Work a waypoint (SPEC §13.2, backs `feature.workWaypoint`). A `research`
 * waypoint is worked AFK: it claims the waypoint for a headless `research` run
 * and returns `{ runId }`. Every other type opens a kind=`waypoint` HITL session
 * (claimed transactionally inside `launchSession`) and returns `{ sessionId }`.
 * Refuses up front when the feature is not mapped, the waypoint belongs to
 * another feature, or (HITL only) a waypoint session is already live (one live
 * HITL session per feature). The claim — inside `launchSession` for HITL, inside
 * `startRun` for research — is the transactional frontier gate, so a waypoint
 * that is claimed/terminal/blocked can never be worked.
 */
export async function workWaypoint(
  ctx: AppCtx,
  input: { featureId: string; waypointId: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult | WorkRunResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  if (!feature.mapped) {
    throw new GateError(`feature ${feature.slug} is not mapped — it has no waypoints to work`)
  }

  const wp = getWaypoint(ctx, input.waypointId)
  if (wp.featureId !== feature.id) {
    throw new GateError(`waypoint ${wp.seq} does not belong to feature ${feature.slug}`)
  }

  // Research waypoints run AFK (SPEC §13.2): claim the waypoint for the run (the
  // transactional frontier gate lives in `startRun`) and hand it the waypoint as
  // per-run input. Run failure/cancel auto-releases it back to the frontier.
  if (wp.type === 'research') {
    const { runId } = await startRun(ctx, feature.id, 'research', {
      input: wp,
      claimWaypointId: wp.id,
    })
    return { runId }
  }

  // Fast-fail guard on live HITL SESSION rows + active runs (never on waypoint
  // claims — a parallel research run's claim must not block HITL work, and a
  // resolved claim must not unblock a second terminal while the first is live).
  // The race-free authoritative recheck runs inside `launchSession`.
  assertSpawnable(ctx, feature)

  return launchSession(ctx, { featureId: feature.id, kind: 'waypoint', waypointId: wp.id }, opts)
}

/**
 * Converge a mapped feature (ADR-0001 / SPEC §13.2, backs `feature.converge`).
 *
 * G1 for a mapped feature is `all-waypoints-terminal` (SPEC §13.1): convergence
 * is refused while any waypoint is still open or claimed — UNLESS the caller
 * supplies an `overrideReason`, exactly like every other gate (the seatbelt, not
 * the cage). Remaining fog (`Not yet specified` prose) is never checked here — it
 * is a soft UI warning, shown but never enforced.
 *
 * Crossing G1 advances the feature into `spec`, so the fresh kind=`converge`
 * session it spawns rejoins the normal pipeline with NO downstream
 * special-casing: it reads
 * only the compressed knowledge (map + decisions) and runs the existing
 * spec → tickets skills unbroken.
 */
export async function converge(
  ctx: AppCtx,
  input: { featureId: string; overrideReason?: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = getFeatureRow(ctx, input.featureId)
  if (!feature.mapped) {
    throw new GateError(`feature ${feature.slug} is not mapped — convergence is only for mapped features`)
  }
  if (feature.phase !== 'ideation') {
    return reconverge(ctx, feature, opts)
  }

  const gate = nextGate(feature)
  if (!gate) throw new GateError('feature is already at the final phase')
  const result = checkGate(ctx, gate.check, feature)

  if (result.satisfied) {
    // Cross G1 into spec. G1 is never G3, so this plain crossing is legitimate.
    const next = nextPhase(feature)
    if (!next) throw new GateError('feature is already at the final phase')
    setPhase(ctx, feature.id, next, 'phase.advanced', `converging (${next})`)
  } else if (input.overrideReason) {
    // The seatbelt, not the cage: record a G1 override and advance anyway.
    overrideGate(ctx, feature.id, gate.id, input.overrideReason)
  } else {
    throw new GateError(result.reason ?? 'the map is not ready to converge — resolve its waypoints or override with a reason')
  }

  return launchSession(ctx, { featureId: feature.id, kind: 'converge' }, opts)
}

/**
 * RE-convergence (E2E finding 3): a converge session that crashed or was closed
 * mid-way leaves the feature stranded — G1 was already crossed (phase `spec`)
 * but no tickets were emitted, and the
 * ideation-only refusal made that state unrecoverable. Allow a fresh
 * kind=converge session exactly in that window: mapped feature at its post-G1,
 * pre-tickets phase with ZERO tickets and no live session. The new session
 * continues from whatever exists on disk (an existing spec.md is read, not
 * rewritten — see the converge skill). Every other phase keeps a clear refusal.
 */
async function reconverge(
  ctx: AppCtx,
  feature: Feature,
  opts: LaunchSessionOptions,
): Promise<LaunchSessionResult> {
  if (feature.phase !== 'spec' && feature.phase !== 'tickets') {
    throw new GateError(
      `converge runs from ideation — feature ${feature.slug} is already at ${feature.phase}`,
    )
  }
  const tickets = listTicketsByFeature(ctx, feature.id)
  if (tickets.length > 0) {
    throw new GateError(
      `feature ${feature.slug} already has ${tickets.length} ticket(s) — convergence completed; work the tickets instead`,
    )
  }
  const live = activeSessionsForFeature(ctx, feature.id)
  if (live.length > 0) {
    throw new GateError(
      `a ${live[0].kind} session is already live for ${feature.slug} — resume or end it instead of re-converging`,
    )
  }
  const running = activeRunFor(ctx, feature.id)
  if (running && workflowClaimsFeatureBranch(running.workflow)) {
    throw new GateError(
      `a ${running.workflow} run is in progress on ${feature.slug} — converge when it finishes`,
    )
  }

  emit(ctx, feature.id, {
    type: 'converge.resumed',
    message: `re-converging from ${feature.phase} — continuing to tickets from the existing docs`,
    data: { phase: feature.phase },
  })
  return launchSession(ctx, { featureId: feature.id, kind: 'converge' }, opts)
}

/**
 * Embedded launch (UI-SPEC §5): spawn `claude` eagerly inside a server-owned PTY
 * with the flags/artifacts from `buildClaudeArgs`, `cwd` = talk worktree, and the
 * two runcastle env vars inherited directly onto the spawn (no `cmd /k`, no
 * `wt.exe`). The PTY is registered by session id; the WS endpoint streams it. On
 * process exit we mark the session ended and emit `session.pty_exited`. A spawn
 * failure is surfaced as an event, never thrown.
 */
/** Spawn-time context the PTY exit handler needs to report honestly. */
export interface SpawnMeta {
  /** The waypoint this session claimed (kind=waypoint), if any. */
  waypoint?: Waypoint
  /** The cc session id this launch tried to `--resume`, if any. */
  resumeSessionId?: string
}

/**
 * PTY exit finalizer (exported for the vitest seam). Marks the session ended,
 * auto-releases its waypoint (SPEC §13.2 — no-op when already resolved), and
 * emits `session.pty_exited`. When a RESUME attempt dies before ever reaching
 * `live` (the session-start hook never fired — e.g. claude exited with "No
 * conversation found with session ID"), it additionally emits
 * `session.resume_failed` so the UI can toast; the waypoint's `lastSessionId`
 * still points at the previous good session (promotion happens only at live),
 * so the next Resume targets the right conversation instead of silently
 * spawning fresh.
 */
export function handlePtyExit(
  ctx: AppCtx,
  feature: Feature,
  session: SessionRow,
  meta: SpawnMeta,
  exitCode: number | undefined | null,
): void {
  const diedBeforeLive = getSessionRow(ctx, session.id)?.status === 'launching'
  markSessionEnded(ctx, session.id)
  // Closing a waypoint terminal without resolving auto-releases its waypoint
  // back to the frontier (SPEC §13.2); no-op for non-waypoint sessions or when
  // the agent already resolved.
  releaseForSession(ctx, session.id)
  if (diedBeforeLive && meta.resumeSessionId) {
    const label = meta.waypoint ? `waypoint ${meta.waypoint.seq} (${meta.waypoint.title})` : session.kind
    emit(ctx, feature.id, {
      type: 'session.resume_failed',
      message: `resume failed for ${label} — the session exited before starting (code ${exitCode ?? 'unknown'}); the previous conversation is still resumable`,
      data: {
        sessionId: session.id,
        waypointId: meta.waypoint?.id ?? null,
        resumeSessionId: meta.resumeSessionId,
        exitCode: exitCode ?? null,
      },
    })
  }
  emit(ctx, feature.id, {
    type: 'session.pty_exited',
    message: ptyExitMessage(exitCode),
    data: { sessionId: session.id, exitCode: exitCode ?? null },
  })
}

/**
 * CC nesting markers leaked from a parent Claude Code session (the server is
 * routinely started from inside one during dogfooding). `CLAUDE_CODE_CHILD_SESSION`
 * alone makes CC ≥ 2.1.211 skip writing the session transcript entirely —
 * silently breaking `--resume` — and the rest cause related child-session
 * artifacts (bridge frames, inherited session ids/effort). Scrubbed so embedded
 * sessions are first-class no matter how the server was launched.
 */
const CC_NESTING_ENV = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_SSE_PORT',
] as const

function spawnEmbeddedPty(
  ctx: AppCtx,
  feature: Feature,
  session: SessionRow,
  worktreePath: string,
  serverUrl: string,
  claudeArgs: string[],
  meta: SpawnMeta = {},
): void {
  const { file, args } = claudeSpawnTarget(claudeArgs)
  const env: Record<string, string | undefined> = {
    ...process.env,
    RUNCASTLE_SESSION_ID: session.id,
    RUNCASTLE_SERVER_URL: serverUrl,
  }
  for (const key of CC_NESTING_ENV) delete env[key]
  try {
    const entry = ptyRegistry().create({
      sessionId: session.id,
      cmd: file,
      args,
      opts: { cwd: worktreePath, env, cols: 80, rows: 24, useConpty: true },
      onExit: ({ exitCode }) => handlePtyExit(ctx, feature, session, meta, exitCode),
    })
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'embedded terminal spawned',
      data: { sessionId: session.id, mode: 'embedded', pid: entry.pty.pid },
    })
  } catch (err) {
    // A session that never got a process must not linger `launching` — the
    // one-live-session guard reads session rows, so a leaked row would block
    // every future terminal on this feature until the next boot reconciliation.
    markSessionEnded(ctx, session.id)
    releaseForSession(ctx, session.id)
    emit(ctx, feature.id, {
      type: 'session.spawn_failed',
      message: `failed to spawn embedded terminal: ${err instanceof Error ? err.message : String(err)}`,
      data: { sessionId: session.id, mode: 'embedded' },
    })
  }
}
