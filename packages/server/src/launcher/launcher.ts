import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, Project, SessionKind, SessionRow, Waypoint } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { nextGate, nextPhase } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError, isNotImplemented } from '../errors'
import { ptyRegistry } from '../pty/registry'
import { emit } from '../services/events'
import { checkGate, overrideGate } from '../services/gates'
import * as git from '../services/git'
import { getFeatureRow, requireProject, setPhase } from '../services/repo'
import {
  claim as claimWaypoint,
  claimedForFeature,
  getWaypoint,
  releaseForSession,
} from '../services/waypoints'
import { startRun } from '../workflows/runner'
import { serverUrlFor, writeSessionArtifacts } from './artifacts'
import { createSessionRow, getSessionRow, markSessionEnded } from './sessions'

// Re-exported so the `feature.endSession` router (W2) imports the real,
// PTY-killing service from `../../launcher/launcher` per its coordination note —
// the implementation lives in the PTY layer (`pty/end-session`).
export { endSession, type EndSessionResult } from '../pty/end-session'

/**
 * Session launcher (SPEC §5). Spawns a real, injected Claude Code terminal in a
 * fresh Windows Terminal tab: creates the session row, ensures the talk
 * worktree, writes the launch artifacts, then opens `wt.exe` running `claude`
 * with our settings/mcp/plugin flags and the per-tab env embedded in the command
 * line (the env-propagation caveat in SPEC §5.4).
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
}

export interface LaunchSessionOptions {
  /**
   * Open the Windows Terminal tab (default true). Set false to fabricate a
   * session end-to-end MINUS the terminal spawn — the row, talk worktree and
   * launch artifacts are all created for real; only `wt.exe` is skipped. Used by
   * the scripted smoke (SPEC §11) so it can drive hooks/MCP against a real live
   * session without opening a terminal.
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
   * The Claude Code session id (`ccSessionId`) to `--resume`. Set when re-working
   * a waypoint whose previous session was auto-released so the operator picks up
   * the same conversation (SPEC §13.6 "Resume"). `--resume` is scoped to the
   * project dir + its worktrees (CC-INTEGRATION-NOTES §7), which the talk worktree
   * satisfies. Omitted → a fresh session.
   */
  resumeSessionId?: string
}

export interface LaunchCommand {
  /** The inner `claude ...` invocation (SPEC §5.3). */
  claudeCommand: string
  /** The full `wt.exe ...` command line with env embedded (SPEC §5.4). */
  display: string
}

/** Double-quote a path for a Windows command line. */
function q(p: string): string {
  return `"${p}"`
}

/** Quote a command-line token iff it carries a path/space char (bare flags stay bare). */
function quoteArg(a: string): string {
  return /[\\/: ]/.test(a) ? `"${a}"` : a
}

/**
 * The `claude` argv AFTER the program name (UI-SPEC §5.3). This is the SINGLE
 * source of the flag list: `buildLaunchCommand` renders it into the `wt.exe`
 * command string (window mode) and `launchSession` passes it verbatim to the PTY
 * spawn (embedded mode), so the flags/artifacts never drift between the two.
 * `--append-system-prompt-file` is a verified flag (CC-INTEGRATION-NOTES §7).
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
  ]
}

/**
 * Assemble the launch command (pure — the tested contract). Produces the exact
 * SPEC §5.3/§5.4 string: `wt.exe -w 0 nt` opening a `cmd /k` tab that first
 * `set`s the two runcastle env vars (no space before `&&`, so no trailing space
 * leaks into the value) and then runs `claude` with our flags. The inner claude
 * invocation is rendered from `buildClaudeArgs` so it stays byte-identical to the
 * embedded PTY spawn.
 */
export function buildLaunchCommand(input: BuildLaunchInput): LaunchCommand {
  const claudeCommand = ['claude', ...buildClaudeArgs(input).map(quoteArg)].join(' ')

  // No space before `&&`: `set VAR=value&&` — a trailing space would be stored
  // in the value (SPEC §5.4 gotcha).
  const envPrefix =
    `set RUNCASTLE_SESSION_ID=${input.sessionId}&& ` +
    `set RUNCASTLE_SERVER_URL=${input.serverUrl}&& `
  const cmdk = `${envPrefix}${claudeCommand}`

  const display =
    `wt.exe -w 0 nt --title ${q(`runcastle: ${input.featureTitle}`)} ` +
    `-d ${q(input.worktreePath)} cmd /k ${q(cmdk)}`

  return { claudeCommand, display }
}

/**
 * Resolve the `claude` executable to an absolute path. `RUNCASTLE_CLAUDE_BIN`
 * overrides; otherwise PATH is scanned for `claude` with Windows extensions.
 * Falls back to the bare name so `CreateProcess`/exec can make a final attempt.
 */
function resolveClaudeExecutable(): string {
  const override = process.env.RUNCASTLE_CLAUDE_BIN
  if (override && existsSync(override)) return override
  const isWin = process.platform === 'win32'
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = (process.env.PATH ?? '').split(isWin ? ';' : ':')
  for (const dir of dirs) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `claude${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return 'claude'
}

/**
 * The `{file, args}` to spawn `claude` inside a PTY. A native `.exe` is spawned
 * directly; a `.cmd`/`.bat` shim is run via `cmd.exe /c` (ConPTY cannot exec a
 * batch file directly). Env is inherited on the spawn (UI-SPEC §5 — no `cmd /k`
 * env prefix, no `wt.exe`).
 */
function claudeSpawnTarget(claudeArgs: string[]): { file: string; args: string[] } {
  const exe = resolveClaudeExecutable()
  if (/\.(cmd|bat)$/i.test(exe)) {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/c', exe, ...claudeArgs] }
  }
  return { file: exe, args: claudeArgs }
}

/**
 * Resolve the `runcastle` plugin dir (`packages/skills/packs/runcastle`).
 * Ascends from this module looking for the marker dir (robust against the
 * server being run from anywhere), falling back to the fixed 4-up repo layout.
 */
export function resolvePluginDir(): string {
  const rel = join('packages', 'skills', 'packs', 'runcastle')
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, rel))) return join(dir, rel)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: <root>/packages/server/src/launcher -> up 4 -> <root>
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  return join(root, rel)
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
  const project = requireProject(ctx)

  const worktreePath = await ensureWorktree(ctx, project, feature)
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: input.kind,
    worktreePath,
  })

  // A waypoint session claims its waypoint BEFORE spawning (SPEC §13.2). Capture
  // the prior session's cc id first (claim overwrites `lastSessionId`) so a
  // released-then-reworked waypoint resumes the same conversation. A failed claim
  // (no longer on the frontier) ends the just-created session row and rethrows.
  let waypoint: Waypoint | undefined
  let resumeSessionId: string | undefined
  if (input.waypointId) {
    const before = getWaypoint(ctx, input.waypointId)
    if (before.lastSessionId) {
      resumeSessionId = getSessionRow(ctx, before.lastSessionId)?.ccSessionId ?? undefined
    }
    try {
      // Re-check "only one live HITL session per feature" here, synchronously
      // adjacent to the claim itself (no `await` between the two). `workWaypoint`
      // already checks this up front, but that check runs before this function's
      // `await ensureWorktree` above — leaving a window where two concurrent Work
      // calls on two DIFFERENT waypoints of the same feature both pass it before
      // either claims. This recheck is the race-free, authoritative gate.
      const live = claimedForFeature(ctx, feature.id)
      if (live.length > 0) {
        throw new GateError(
          `a waypoint session is already live for ${feature.slug} (waypoint ${live[0].seq}) — only one at a time`,
        )
      }
      waypoint = claimWaypoint(ctx, input.waypointId, session.id)
    } catch (e) {
      markSessionEnded(ctx, session.id)
      throw e
    }
  }

  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching ${input.kind} session`,
    data: { sessionId: session.id, kind: input.kind, worktreePath, waypointId: waypoint?.id },
  })

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
    resumeSessionId,
  }

  // spawn:false fabricates a session MINUS any process (SPEC §11 smoke driver) —
  // honoured in both launch modes.
  if (opts.spawn === false) {
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: buildLaunchCommand(buildInput).display, spawned: false },
    })
    return { sessionId: session.id }
  }

  if (ctx.config.launchMode === 'window') {
    spawnTerminal(ctx, feature.id, session.id, buildLaunchCommand(buildInput))
  } else {
    spawnEmbeddedPty(ctx, feature, session, worktreePath, serverUrl, buildClaudeArgs(buildInput))
  }
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

  const live = claimedForFeature(ctx, feature.id)
  if (live.length > 0) {
    throw new GateError(
      `a waypoint session is already live for ${feature.slug} (waypoint ${live[0].seq}) — only one at a time`,
    )
  }

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
 * Crossing G1 advances the feature into `spec` (or `tickets` for a collapsed
 * feature — nextPhase is unchanged), so the fresh kind=`converge` session it
 * spawns rejoins the normal pipeline with NO downstream special-casing: it reads
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
    throw new GateError(`converge runs from ideation — feature ${feature.slug} is already at ${feature.phase}`)
  }

  const gate = nextGate(feature)
  if (!gate) throw new GateError('feature is already at the final phase')
  const result = checkGate(ctx, gate.check, feature)

  if (result.satisfied) {
    // Cross G1 into spec (or tickets for a collapsed feature — nextPhase is
    // unchanged). G1 is never G3, so this plain crossing is legitimate.
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
 * Embedded launch (UI-SPEC §5): spawn `claude` eagerly inside a server-owned PTY
 * with the EXACT same flags/artifacts as the window path (`buildClaudeArgs`),
 * `cwd` = talk worktree, and the two runcastle env vars inherited directly onto
 * the spawn (no `cmd /k`, no `wt.exe`). The PTY is registered by session id; the
 * WS endpoint streams it. On process exit we mark the session ended and emit
 * `session.pty_exited`. A spawn failure is surfaced as an event, never thrown.
 */
function spawnEmbeddedPty(
  ctx: AppCtx,
  feature: Feature,
  session: SessionRow,
  worktreePath: string,
  serverUrl: string,
  claudeArgs: string[],
): void {
  const { file, args } = claudeSpawnTarget(claudeArgs)
  const env = {
    ...process.env,
    RUNCASTLE_SESSION_ID: session.id,
    RUNCASTLE_SERVER_URL: serverUrl,
  }
  try {
    const entry = ptyRegistry().create({
      sessionId: session.id,
      cmd: file,
      args,
      opts: { cwd: worktreePath, env, cols: 80, rows: 24, useConpty: true },
      onExit: ({ exitCode }) => {
        markSessionEnded(ctx, session.id)
        // Closing a waypoint terminal without resolving auto-releases its
        // waypoint back to the frontier (SPEC §13.2); no-op for non-waypoint
        // sessions or when the agent already resolved.
        releaseForSession(ctx, session.id)
        emit(ctx, feature.id, {
          type: 'session.pty_exited',
          message: ptyExitMessage(exitCode),
          data: { sessionId: session.id, exitCode: exitCode ?? null },
        })
      },
    })
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'embedded terminal spawned',
      data: { sessionId: session.id, mode: 'embedded', pid: entry.pty.pid },
    })
  } catch (err) {
    emit(ctx, feature.id, {
      type: 'session.spawn_failed',
      message: `failed to spawn embedded terminal: ${err instanceof Error ? err.message : String(err)}`,
      data: { sessionId: session.id, mode: 'embedded' },
    })
  }
}

/**
 * Open the Windows Terminal tab (best-effort). We route the SPEC §5.4 command
 * line through `cmd.exe /s /c "<display>"`: `/s` forces cmd's deterministic
 * "strip only the outermost quote pair" rule, and `windowsVerbatimArguments`
 * stops Node re-quoting, so the nested quotes in `--title`/`-d`/`cmd /k` reach
 * `wt.exe` intact. A launch failure is surfaced as an event, never thrown — the
 * session row already exists and can be relaunched.
 */
function spawnTerminal(
  ctx: AppCtx,
  featureId: string,
  sessionId: string,
  cmd: LaunchCommand,
): void {
  try {
    const child = spawn('cmd.exe', ['/s', '/c', `"${cmd.display}"`], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    })
    child.on('error', (err) => {
      emit(ctx, featureId, {
        type: 'session.spawn_failed',
        message: `failed to open terminal: ${err.message}`,
        data: { sessionId },
      })
    })
    child.unref()
    emit(ctx, featureId, {
      type: 'session.launched',
      message: 'terminal opened',
      data: { sessionId, command: cmd.display },
    })
  } catch (err) {
    emit(ctx, featureId, {
      type: 'session.spawn_failed',
      message: `failed to open terminal: ${err instanceof Error ? err.message : String(err)}`,
      data: { sessionId },
    })
  }
}
