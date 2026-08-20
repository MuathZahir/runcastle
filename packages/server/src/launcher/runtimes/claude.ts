import type { SessionKind } from '@runcastle/core'
import { resolveTool } from '../../util/resolve-executable'
import { writeSessionArtifacts } from '../artifacts'
import { resolvePluginDir } from '../skills-root'
import { kickoffLinesFor } from './skills'
import type { AgentRuntimeAdapter, RuntimeLaunchInput, RuntimeLaunchSpec, RuntimeReadiness } from './types'

/**
 * The Claude Code adapter (SPEC §5 / UI-SPEC §5) — today's launch behaviour,
 * unchanged, behind the {@link AgentRuntimeAdapter} contract.
 *
 * Claude Code takes its whole per-session configuration through FLAGS against
 * the human's real `~/.claude` (decision 8). We deliberately do not relocate it
 * with `CLAUDE_CONFIG_DIR`: on Windows the credentials live inside the config
 * dir, so a per-session one would force a re-login on every spawn, fire the
 * first-run onboarding in the terminal, and orphan the human's real state.
 */

/**
 * The `claude` argv AFTER the program name (UI-SPEC §5.3). The embedded PTY
 * spawn passes it verbatim, and the `spawn:false` smoke path renders it for its
 * `session.launched` event, so the flags/artifacts never drift.
 * `--append-system-prompt-file` is a verified flag (CC-INTEGRATION-NOTES §7).
 *
 * `--mcp-config` is unconditional (it is how the session reaches runcastle's own
 * MCP server); `--strict-mcp-config` is opt-in, because it does not merely
 * prefer our config — it suppresses every other MCP source, including the
 * human's own connections and their plugins' servers.
 */
export interface BuildLaunchInput {
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
  /**
   * Add `--strict-mcp-config` (config `sessionMcp: 'runcastleOnly'`). Default
   * false: a session inherits the human's own MCP servers alongside
   * runcastle's — see {@link RuncastleConfig.sessionMcp}.
   */
  strictMcp?: boolean
}

/** @see {@link BuildLaunchInput} */
export function buildClaudeArgs(input: BuildLaunchInput): string[] {
  const permissionMode = input.permissionMode ?? 'acceptEdits'
  const resume = input.resumeSessionId ? ['--resume', input.resumeSessionId] : []
  return [
    ...resume,
    '--settings',
    input.settingsPath,
    '--mcp-config',
    input.mcpConfigPath,
    ...(input.strictMcp ? ['--strict-mcp-config'] : []),
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
 * CC nesting markers leaked from a parent Claude Code session (the server is
 * routinely started from inside one during dogfooding). `CLAUDE_CODE_CHILD_SESSION`
 * alone makes CC ≥ 2.1.211 skip writing the session transcript entirely —
 * silently breaking `--resume` — and the rest cause related child-session
 * artifacts (bridge frames, inherited session ids/effort). Scrubbed so embedded
 * sessions are first-class no matter how the server was launched.
 */
export const CC_NESTING_ENV = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_SSE_PORT',
] as const

/**
 * The kickoff lines a Claude Code session is opened with — the shared per-kind
 * table (see {@link kickoffLinesFor}), spelled `/runcastle:x` because that is how
 * Claude Code invokes a pack skill. Reached through {@link claudeRuntime}'s
 * `kickoffLine`, never indexed directly by the launcher.
 */
export const KICKOFF_LINES: Record<SessionKind, string> = kickoffLinesFor('claude-code')

/** The converge kickoff line, unchanged (E2E-proven — kept named for clarity). */
export const CONVERGE_KICKOFF_LINE = KICKOFF_LINES.converge

/** The CLI name, as `resolveTool` and the doctor's `claude` probe both spell it. */
const CLAUDE_BIN = 'claude'

export const claudeRuntime: AgentRuntimeAdapter = {
  id: 'claude-code',
  binary: CLAUDE_BIN,

  /**
   * `RUNCASTLE_CLAUDE_BIN` overrides; otherwise PATH is scanned for `claude`
   * with Windows extensions. Falls back to the bare name so `CreateProcess`/exec
   * can make a final attempt.
   */
  resolveBinary(): string {
    return resolveTool(CLAUDE_BIN)
  },

  /**
   * Ready when the CLI is somewhere this server can see it. `resolveTool`
   * returns the bare name when its PATH scan and its well-known-dirs recovery
   * both came up empty, which is exactly the case a spawn would fail on — and
   * failing here means the human gets a sentence naming the doctor probe instead
   * of an ENOENT from inside a terminal that closed as fast as it opened.
   */
  checkReady(): RuntimeReadiness {
    if (this.resolveBinary() !== CLAUDE_BIN) return { ok: true }
    return {
      ok: false,
      reason:
        'the Claude Code CLI (`claude`) is not on the PATH this runcastle server inherited, ' +
        'nor in the usual install locations',
      doctorHint:
        'Run `runcastle doctor` and fix its "Claude Code CLI" probe, then restart runcastle ' +
        'from a terminal where `claude --version` works.',
    }
  },

  async writeArtifacts(input: RuntimeLaunchInput): Promise<RuntimeLaunchSpec> {
    // The adapter names the runtime the briefing is rendered for, so the prompt's
    // skill spelling can never disagree with the CLI that is about to read it.
    const files = await writeSessionArtifacts({ ...input, runtime: this.id })
    return {
      files: [files.systemPromptPath, files.settingsPath, files.mcpConfigPath],
      argv: buildClaudeArgs({
        pluginDir: resolvePluginDir(),
        settingsPath: files.settingsPath,
        mcpConfigPath: files.mcpConfigPath,
        systemPromptPath: files.systemPromptPath,
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        model: input.model,
        ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        strictMcp: input.config.sessionMcp === 'runcastleOnly',
      }),
      env: {
        RUNCASTLE_SESSION_ID: input.session.id,
        RUNCASTLE_SERVER_URL: input.serverUrl,
      },
      envScrub: CC_NESTING_ENV,
    }
  },

  kickoffLine(kind: SessionKind): string {
    return KICKOFF_LINES[kind]
  },
}
