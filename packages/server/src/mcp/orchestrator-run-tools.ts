import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ResolveSession } from './orchestrator-tools'

/**
 * The orchestrator's tools that launch or end a headless run on a feature
 * (`whole-cuts-plan-themselves`): planning it, relaying a message to its
 * planning conversation, stopping its run, and planning its next lap.
 *
 * A socket for now — a later ticket of this lap registers them here. The MCP
 * server already calls it.
 */
export function registerOrchestratorRunTools(
  _server: McpServer,
  _wants: (tool: string) => boolean,
  _resolve: ResolveSession,
): void {}
