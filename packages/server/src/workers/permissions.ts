import type { AgentRuntime } from '@runcastle/core'
import { CODEX_AUTO_REVIEW_MODE } from './sandbox'

/**
 * How a worker's agent is allowed to act (interactive-workers decisions 10, 11).
 *
 * - `auto`: Claude Code's auto mode, or Codex's auto-review. Its checker blocks
 *   anything irreversible, destructive or aimed outside the sandbox; the human's
 *   own allow, ask and deny rules apply first.
 * - `fallback`: auto mode is not available to the worker's login or model (the
 *   adapter says so by opening, or switching, the session in another mode).
 *
 * In either, whatever the agent still asks is allowed by the host, never asked
 * of the human (agents-never-stop-for-approval decision 6).
 */
export type WorkerPermissionMode = 'auto' | 'fallback'

/**
 * The mode a worker runs in when its session reports `modeId`: Claude Code's
 * `auto`, or codex-acp's `agent` (Codex's auto-review); any other mode is the
 * fallback. Undefined for Claude Code's plan mode, which is neither and changes nothing.
 */
export function permissionModeOf(modeId: string, runtime: AgentRuntime = 'claude-code'): WorkerPermissionMode | undefined {
  if (runtime === 'codex') return modeId === CODEX_AUTO_REVIEW_MODE ? 'auto' : 'fallback'
  if (modeId === 'plan') return undefined
  return modeId === 'auto' ? 'auto' : 'fallback'
}
