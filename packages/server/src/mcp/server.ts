import { Hono } from 'hono'

/**
 * MCP server — WAVE B1 (SPEC §6): Streamable HTTP at `POST /mcp` exposing the 4
 * zod-validated tools (get_feature_context, emit_tickets, record_event,
 * complete_phase). Typed stub: a Hono sub-app returning 501 for every route, so
 * the `/mcp` mount exists and the app boots before B1 lands. B1 replaces this
 * with `@hono/mcp` (StreamableHTTPTransport) + `@modelcontextprotocol/sdk` per
 * docs/research/STACK-NOTES.md §5.
 */
const mcp = new Hono()

mcp.all('*', (c) => c.json({ error: 'not yet implemented (B1)', wave: 'B1' }, 501))

export default mcp
