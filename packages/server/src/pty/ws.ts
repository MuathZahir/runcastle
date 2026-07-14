import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import { ptyRegistry, type TerminalSink } from './registry'

/**
 * Bun-native WebSocket transport for the embedded terminal (UI-SPEC §5). The
 * endpoint is `/ws/terminal/:sessionId`. `index.ts` (owned by A1, WS wiring
 * granted to W1 by UI-SPEC §6) calls `tryUpgradeTerminal` from its `Bun.serve`
 * `fetch` BEFORE falling through to Hono's `app.fetch`, and passes
 * `terminalWebSocket` as the `websocket` handler.
 *
 * FRAMING (symmetric, unambiguous):
 * - **data**  → binary frames. Server→client: raw PTY output. Client→server:
 *   keystrokes. No JSON parsing, no delimiter ambiguity with terminal bytes.
 * - **control** → text frames carrying JSON: `{t:'resize',cols,rows}` (client→
 *   server) and `{t:'status',status,exitCode?}` (server→client).
 */

const PREFIX = '/ws/terminal/'

interface TerminalWsData {
  sessionId: string
}

/** Per-socket sink, so `close` can detach exactly what `open` attached. */
const sinks = new WeakMap<ServerWebSocket<TerminalWsData>, TerminalSink>()

function extractSessionId(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null
  const rest = pathname.slice(PREFIX.length)
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}

/**
 * If the request targets the terminal WS endpoint, upgrade it and return true
 * (the caller then returns `undefined` from `fetch`). Returns false for any
 * non-terminal path so the Hono app handles it.
 */
export function tryUpgradeTerminal(req: Request, server: Server<TerminalWsData>): boolean {
  const sessionId = extractSessionId(new URL(req.url).pathname)
  if (sessionId === null) return false
  return server.upgrade(req, { data: { sessionId } })
}

export const terminalWebSocket: WebSocketHandler<TerminalWsData> = {
  open(ws) {
    const { sessionId } = ws.data
    const sink: TerminalSink = {
      sendData(chunk) {
        ws.send(chunk)
      },
      sendControl(frame) {
        ws.send(JSON.stringify(frame))
      },
    }
    sinks.set(ws, sink)

    const attached = ptyRegistry().attach(sessionId, sink)
    if (!attached) {
      // No live PTY for this id — tell the client it's over and close so it does
      // not reconnect forever.
      ws.send(JSON.stringify({ t: 'status', status: 'ended', exitCode: 0 }))
      ws.close(1000, 'no such session')
    }
  },

  message(ws, message) {
    const entry = ptyRegistry().get(ws.data.sessionId)
    if (!entry) return
    if (typeof message === 'string') {
      // control frame
      try {
        const frame = JSON.parse(message) as { t?: string; cols?: number; rows?: number }
        if (frame.t === 'resize' && typeof frame.cols === 'number' && typeof frame.rows === 'number') {
          entry.pty.resize(frame.cols, frame.rows)
        }
      } catch {
        // ignore malformed control frames
      }
      return
    }
    // binary data frame → keystrokes
    entry.pty.write(Buffer.from(message).toString('utf8'))
  },

  close(ws) {
    const sink = sinks.get(ws)
    if (sink) {
      ptyRegistry().detach(ws.data.sessionId, sink)
      sinks.delete(ws)
    }
  },
}
