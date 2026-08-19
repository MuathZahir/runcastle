import type { AgentRuntime, SessionKind } from '@runcastle/core'
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
  /** Overrides the runtime's default permission posture (the project session's `default`). */
  permissionMode?: string
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
  /** The line typed into a freshly-live session of `kind` to open it. */
  kickoffLine(kind: SessionKind): string
}
