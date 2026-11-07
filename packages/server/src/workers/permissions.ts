import type * as acp from '@agentclientprotocol/sdk/unstable'
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
 *   Then every tool inside the sandbox is allowed, since it touches only the
 *   worker's own copy, and a call through one of the human's MCP servers asks
 *   the human in the worker's chat.
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

/** The worker's own MCP server: runcastle's tools, never one of the human's. */
const OWN_SERVER = 'worker'

/** Stands for the server of a Codex MCP ask, which names none: never the worker's own, whose tools are pre-approved. */
const CODEX_MCP_ASK = '(an MCP server)'

/** The MCP server a permission ask is for, if it is for an MCP tool at all. */
function mcpServerOf(req: acp.RequestPermissionRequest): string | undefined {
  // codex-acp marks an MCP tool approval on the request itself.
  if ((req._meta as { is_mcp_tool_approval?: unknown } | undefined)?.is_mcp_tool_approval === true) return CODEX_MCP_ASK
  const meta = req.toolCall._meta as { claudeCode?: { mcpServer?: { name?: unknown }; toolName?: unknown } } | undefined
  const named = meta?.claudeCode?.mcpServer?.name
  if (typeof named === 'string') return named
  const tool = typeof meta?.claudeCode?.toolName === 'string' ? meta.claudeCode.toolName : (req.toolCall.title ?? '')
  return /^mcp__(.+?)__/.exec(tool)?.[1]
}

/**
 * Whether the worker answers a permission ask itself, in `mode`: in the
 * fallback, yes for every tool but one of the human's MCP servers; in auto
 * mode never, since whatever auto mode still asks is the human's to answer.
 */
export function workerAllowsItself(mode: WorkerPermissionMode | undefined, req: acp.RequestPermissionRequest): boolean {
  if (mode !== 'fallback') return false
  const server = mcpServerOf(req)
  return server === undefined || server === OWN_SERVER
}
