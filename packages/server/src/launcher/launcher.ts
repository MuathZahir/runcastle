import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, Project, SessionKind, SessionRow } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { isNotImplemented } from '../errors'
import { ptyRegistry } from '../pty/registry'
import { emit } from '../services/events'
import * as git from '../services/git'
import { getFeatureRow, requireProject } from '../services/repo'
import { serverUrlFor, writeSessionArtifacts } from './artifacts'
import { createSessionRow, markSessionEnded } from './sessions'

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
  return [
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

  emit(ctx, feature.id, {
    type: 'session.launching',
    message: `launching ${input.kind} session`,
    data: { sessionId: session.id, kind: input.kind, worktreePath },
  })

  const artifacts = await writeSessionArtifacts({ session, feature, project, config: ctx.config })
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
