import type * as acp from '@agentclientprotocol/sdk/unstable'

/**
 * How a worker's agent is allowed to act (interactive-workers decisions 10, 11).
 *
 * - `auto`: Claude Code's auto mode. Its checker blocks anything irreversible,
 *   destructive or aimed outside the sandbox; the human's own allow, ask and
 *   deny rules apply first.
 * - `fallback`: auto mode is not available to the worker's login or model (the
 *   adapter says so by opening, or switching, the session in another mode).
 *   Then every tool inside the sandbox is allowed, since it touches only the
 *   worker's own copy, and a call through one of the human's MCP servers asks
 *   the human in the worker's chat.
 */
export type WorkerPermissionMode = 'auto' | 'fallback'

/** The mode a worker runs in when its session reports `modeId`; undefined for plan mode, which is neither and changes nothing. */
export function permissionModeOf(modeId: string): WorkerPermissionMode | undefined {
  if (modeId === 'plan') return undefined
  return modeId === 'auto' ? 'auto' : 'fallback'
}

/** The worker's own MCP server: runcastle's tools, never one of the human's. */
const OWN_SERVER = 'worker'

/** The MCP server a permission ask is for, if it is for an MCP tool at all. */
function mcpServerOf(req: acp.RequestPermissionRequest): string | undefined {
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
