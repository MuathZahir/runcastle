/**
 * The never-hidden ceiling for MCP read tools (feature
 * `mcp-read-tools-stay-within-a-context-budget`, decision 3).
 *
 * Past roughly 25K tokens Claude Code saves an MCP result to a file and shows
 * the agent only a pointer, which in practice it often never opens. 60,000
 * characters of serialized JSON is about 20K tokens at dense JSON's ~3
 * chars/token — safely under that spill line. It is a guard against HIDING,
 * not a thrift budget: below it, keeping more inline wins (decision 2).
 *
 * The server's fit logic and the guard test share this one constant so the two
 * cannot drift apart.
 */
export const MCP_READ_CEILING_CHARS = 60_000

/**
 * The length of `result` exactly as a tool reply carries it — the same
 * `JSON.stringify` the MCP handler's `ok()` puts in its text content block.
 */
export function serializedLength(result: unknown): number {
  return JSON.stringify(result).length
}
