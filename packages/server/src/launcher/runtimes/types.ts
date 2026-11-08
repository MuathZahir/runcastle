import type { AgentRuntime, SessionKind, SessionRow } from '@runcastle/core'
import { envInt } from '../../util/env-int'
import type { WriteArtifactsInput } from '../artifacts'

/**
 * The AgentRuntime seam (feature `codex-runtime-support`, decision 8): one
 * adapter per runtime, consumed by the launcher.
 *
 * The interface is symmetric; the mechanism behind it deliberately is not. Claude
 * Code takes its per-session configuration through flags (`--settings`,
 * `--mcp-config`, `--append-system-prompt-file`) against the human's real home,
 * where another runtime may take it through a synthetic per-session home
 * directory instead. Forcing both into the same mechanism would degrade the
 * working path for symmetry's sake, so the symmetry lives here — at the
 * boundary the launcher consumes — and stops there.
 *
 * Everything the launcher needs to spawn a session is one adapter call away, and
 * every launch is fully describable WITHOUT spawning it: {@link
 * AgentRuntimeAdapter.writeArtifacts} returns a complete {@link
 * RuntimeLaunchSpec}, which is what the `spawn:false` smoke path renders and
 * what tests assert against.
 */

/** Whether a runtime can be launched right now — the fail-early precheck. */
export type RuntimeReadiness =
  | { ok: true }
  | {
      ok: false
      /** What is wrong, in the human's terms. */
      reason: string
      /** The doctor fix that resolves it, named so the human has a next step. */
      doctorHint: string
    }

/**
 * What a launch hands its runtime: the session's brief (everything
 * {@link WriteArtifactsInput} carries) plus the launch-time facts no brief
 * knows — where the agent runs, which model it runs, and what it is resuming.
 */
export interface RuntimeLaunchInput extends WriteArtifactsInput {
  /** The agent process's working directory. */
  worktreePath: string
  /** This runcastle server's base URL (its MCP endpoint and hook receiver). */
  serverUrl: string
  /** The model id resolved for this session's step — never the runtime's own default. */
  model: string
  /** The agent-side conversation id to resume; omitted → a fresh conversation. */
  resumeSessionId?: string
  /** The prior runcastle row whose runtime-local persistence backs that conversation. */
  resumeSourceSessionId?: string
  /** The native positional initial prompt; omitted for every resumed conversation. */
  kickoffLine?: string
  /** Overrides the runtime's default permission posture (the orchestrator's `default`). */
  permissionMode?: string
  /**
   * Run non-interactively to completion with {@link kickoffLine} as the prompt
   * (a self-planning or relay run): Claude Code's print
   * mode, Codex's `exec`. Resumes only when {@link resumeSessionId} is given.
   */
  headless?: boolean
}

/** A headless launch has no terminal to type into, so its prompt is the whole briefing. */
export function assertHeadlessKickoff(headless: boolean | undefined, line: string | undefined): void {
  if (headless && !line) throw new Error('a headless launch needs a kickoff line as its prompt')
}

/**
 * The context size at which a feature lead's runtime compacts on its own inside
 * a long turn (lead-chats-stay-small decision 8): Claude Code's
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, Codex's `model_auto_compact_token_limit`.
 * `RUNCASTLE_AUTOCOMPACT_WINDOW` moves it for the install; `0` leaves each
 * runtime's own. The quiet-moment compactions sit beside the idle stop in
 * `threads/host.ts`.
 */
export const AUTOCOMPACT_WINDOW_TOKENS = envInt('RUNCASTLE_AUTOCOMPACT_WINDOW', 200_000)

/**
 * The auto-compact window a session launches with: a feature lead's (its main
 * chat) and an orchestrator chat's (agents-are-woken-only-when-it-matters
 * decision 26), and nobody else's.
 */
export function autoCompactWindow(session: Pick<SessionRow, 'kind' | 'featureId'>): number | undefined {
  const compacts = (session.kind === 'chat' && !!session.featureId) || session.kind === 'project'
  return compacts && AUTOCOMPACT_WINDOW_TOKENS > 0 ? AUTOCOMPACT_WINDOW_TOKENS : undefined
}

/** Keep comfortably below Windows' 32,767-character command-line ceiling. */
export const MAX_KICKOFF_ARGV = 30_000

export function assertKickoffArgv(line: string | undefined): void {
  if (line !== undefined && line.length > MAX_KICKOFF_ARGV) {
    throw new Error(`kickoff line is ${line.length} characters; maximum is ${MAX_KICKOFF_ARGV}`)
  }
}

/** A launch, completely described and not yet spawned. */
export interface RuntimeLaunchSpec {
  /** Absolute paths of every artifact file written for this session. */
  files: readonly string[]
  /** The argv AFTER the program name. */
  argv: string[]
  /** Env vars to set over the inherited process env. */
  env: Record<string, string>
  /** Env var names to DELETE from the inherited process env. */
  envScrub: readonly string[]
}

/**
 * A conversation's launch over ACP (chat-as-web-components; ADR-0015),
 * completely described and not yet spawned: the runtime's ACP adapter as a
 * child process speaking ACP on stdio, and the `_meta` its `session/new` /
 * `session/load` carries. The briefing files are the same ones
 * {@link AgentRuntimeAdapter.writeArtifacts} writes; only how they reach the
 * CLI differs (Claude: through `_meta.claudeCode.options`; Codex: its
 * per-session `CODEX_HOME`).
 */
export interface AcpLaunchSpec {
  /** Absolute paths of every artifact file written for this session. */
  files: readonly string[]
  /** The adapter program and its argv (e.g. the resolved `claude-agent-acp` entry run by node or bun). */
  command: string
  args: string[]
  /** Env vars to set over the inherited process env (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`, `CODEX_HOME`, `RUNCASTLE_SESSION_ID`…). */
  env: Record<string, string>
  /** Env var names to DELETE from the inherited process env. */
  envScrub: readonly string[]
  /** The `_meta` sent with `session/new` and `session/load`. */
  sessionMeta: Record<string, unknown>
  /**
   * The ACP session mode the session must run in, set with `session/set_mode`
   * when `session/new` / `session/load` reports another. claude-agent-acp
   * ignores a permission mode in its `_meta` options and starts in the
   * settings' default mode, so the launch's posture is applied this way.
   */
  sessionMode?: string
  /**
   * Trust the session's hooks through codex-acp's `_codex/hooks/trust` once
   * the session is open: Codex runs no hook it has not trusted, and its ACP
   * adapter has no `--dangerously-bypass-hook-trust`.
   */
  trustHooks?: boolean
}

export interface AgentRuntimeAdapter {
  /** The runtime this adapter launches — the `runtime` of every model that selects it. */
  readonly id: AgentRuntime
  /** The CLI this runtime spawns, spelled as it appears on PATH (`claude`). */
  readonly binary: string
  /** {@link binary} resolved to an absolute path, ready to spawn. */
  resolveBinary(): string
  /** Whether a launch on this runtime can succeed — checked before anything is created. */
  checkReady(): RuntimeReadiness
  /** Write this session's artifacts and describe the launch they belong to. */
  writeArtifacts(input: RuntimeLaunchInput): Promise<RuntimeLaunchSpec>
  /**
   * Describe this session's launch over ACP (ADR-0015). `kickoffLine` and
   * `headless` in the input are ignored here — over ACP the kickoff is the
   * thread's first prompt and nothing is headless.
   */
  acpLaunch(input: RuntimeLaunchInput): Promise<AcpLaunchSpec>
  /** The line typed into a freshly-live session of `kind` to open it. */
  kickoffLine(kind: SessionKind): string
  /**
   * The runtime's own background session holding the conversation `agentSessionId`,
   * if one does — which makes that conversation refuse to be resumed here.
   * Omitted by runtimes that have no background sessions.
   */
  findBackgroundSession?(agentSessionId: string): Promise<BackgroundSession | undefined>
}

/** A conversation the runtime is running in the background, outside any runcastle terminal. */
export interface BackgroundSession {
  /** The agent-side conversation id. */
  sessionId: string
  /** The short id the runtime's own `attach` / `stop` commands take. */
  shortId: string
}
