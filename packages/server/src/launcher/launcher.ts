import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, Project, SessionKind } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { isNotImplemented } from '../errors'
import { emit } from '../services/events'
import * as git from '../services/git'
import { getFeatureRow, requireProject } from '../services/repo'
import { serverUrlFor, writeSessionArtifacts } from './artifacts'
import { createSessionRow } from './sessions'

/**
 * Session launcher (SPEC §5). Spawns a real, injected Claude Code terminal in a
 * fresh Windows Terminal tab: creates the session row, ensures the talk
 * worktree, writes the launch artifacts, then opens `wt.exe` running `claude`
 * with our settings/mcp/plugin flags and the per-tab env embedded in the command
 * line (the env-propagation caveat in SPEC §5.4).
 */

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

/**
 * Assemble the launch command (pure — the tested contract). Produces the exact
 * SPEC §5.3/§5.4 string: `wt.exe -w 0 nt` opening a `cmd /k` tab that first
 * `set`s the two runcastle env vars (no space before `&&`, so no trailing space
 * leaks into the value) and then runs `claude` with our flags.
 * `--append-system-prompt-file` is a verified flag (CC-INTEGRATION-NOTES §7).
 */
export function buildLaunchCommand(input: BuildLaunchInput): LaunchCommand {
  const permissionMode = input.permissionMode ?? 'acceptEdits'
  const claudeCommand = [
    'claude',
    `--settings ${q(input.settingsPath)}`,
    `--mcp-config ${q(input.mcpConfigPath)}`,
    '--strict-mcp-config',
    `--plugin-dir ${q(input.pluginDir)}`,
    `--append-system-prompt-file ${q(input.systemPromptPath)}`,
    `--permission-mode ${permissionMode}`,
  ].join(' ')

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

  const cmd = buildLaunchCommand({
    sessionId: session.id,
    serverUrl: serverUrlFor(ctx.config),
    featureTitle: feature.title,
    worktreePath,
    pluginDir: resolvePluginDir(),
    settingsPath: artifacts.settingsPath,
    mcpConfigPath: artifacts.mcpConfigPath,
    systemPromptPath: artifacts.systemPromptPath,
  })

  if (opts.spawn === false) {
    emit(ctx, feature.id, {
      type: 'session.launched',
      message: 'session prepared (terminal spawn skipped)',
      data: { sessionId: session.id, command: cmd.display, spawned: false },
    })
  } else {
    spawnTerminal(ctx, feature.id, session.id, cmd)
  }
  return { sessionId: session.id }
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
