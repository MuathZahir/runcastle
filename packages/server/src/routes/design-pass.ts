import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import type { RuncastleConfig } from '@runcastle/core'
import { SERVE_HOSTNAME, SERVE_IDLE_TIMEOUT_SECONDS } from '../config'
import { phoneDesignPort } from '../services/phone-link'

/**
 * The design pass-through (runcastle-on-your-phone, decision 5): the phone's
 * Design screen reaches a feature's design server through this listener, on
 * `serverPort + 2`, behind `tailscale serve`.
 *
 * A design server is a dev server on the host's localhost that refuses any
 * other hostname (Vite's "Blocked request. This host is not allowed"), and on
 * Windows answers on `::1` rather than `127.0.0.1`. So every request goes to the
 * URL the server printed, with `Host`, `Origin` and `Referer` rewritten to it.
 *
 * Which feature a request is for comes from a cookie the entry path sets:
 * `GET /__runcastle/open/<featureId>?path=/x` sets it and redirects to `/x`, so
 * the page and everything it loads afterwards — scripts, styles, the hot-reload
 * WebSocket — carry it. Staying on its own port keeps project code on a
 * different origin from runcastle's API.
 */

/** The cookie naming the feature whose design server this listener forwards to. */
export const DESIGN_COOKIE = 'runcastle_design'
/** The entry path's prefix; the feature id follows it. */
export const DESIGN_OPEN_PREFIX = '/__runcastle/open/'

/**
 * The page's reachability probe (decisions 23, 26): a browser on another
 * machine asks this before it loads a design, so a port its tunnel does not
 * forward is said in words rather than as a browser error. Readable from any
 * origin, since the app is on a different port.
 */
export const DESIGN_PING_PATH = '/__runcastle/ping'

/** The URL a feature's running design server printed, or undefined when none runs. */
export type DesignLookup = (featureId: string) => string | undefined

/** Headers that belong to one connection and never cross a proxy (RFC 9110 §7.6.1). */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

function withoutHopByHop(source: Headers): Headers {
  const headers = new Headers(source)
  const named = source.get('connection')?.split(',').map((h) => h.trim().toLowerCase()) ?? []
  for (const h of [...HOP_BY_HOP, ...named]) if (h) headers.delete(h)
  return headers
}

function cookieFeature(req: Request): string | undefined {
  for (const part of req.headers.get('cookie')?.split(';') ?? []) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === DESIGN_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim()) || undefined
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** A path on this same site: one leading slash, never `//host` or `/\host`, which a browser reads as another site. */
function isLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}

/** A small page a phone can read, for when there is nothing to forward to. */
function page(status: number, title: string, body: string): Response {
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title>` +
    '<body style="font:16px/1.5 system-ui,sans-serif;margin:0;padding:32px 24px;color:#444">' +
    `<h1 style="font-size:18px;margin:0 0 8px">${title}</h1><p style="margin:0">${body}</p>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

const notRunning = () =>
  page(503, 'The design server is not running', 'Go back and open Design again to start it, or ask the chat to show you a design.')

/** The design server's URL for this request's cookie, or undefined when none runs. */
function targetFor(req: Request, lookup: DesignLookup): URL | undefined {
  const featureId = cookieFeature(req)
  const printed = featureId ? lookup(featureId) : undefined
  if (!printed) return undefined
  try {
    return new URL(printed)
  } catch {
    return undefined
  }
}

/** The entry path: remember the feature in a cookie, then go to the page asked for. */
function open(url: URL): Response {
  let featureId = ''
  try {
    featureId = decodeURIComponent(url.pathname.slice(DESIGN_OPEN_PREFIX.length))
  } catch {
    // a malformed escape names no feature
  }
  const path = url.searchParams.get('path') ?? '/'
  if (!featureId || featureId.includes('/')) return page(404, 'No such design', 'This link names no feature.')
  if (!isLocalPath(path)) return page(400, 'Not a page of this design', 'The link points somewhere else, so it is not followed.')
  return new Response(null, {
    status: 302,
    headers: {
      location: path,
      'set-cookie': `${DESIGN_COOKIE}=${encodeURIComponent(featureId)}; Path=/; HttpOnly; SameSite=Lax; Secure`,
      'cache-control': 'no-store',
    },
  })
}

/** `Origin` and `Referer` as the design server would see them from its own page. */
function rewriteOrigins(headers: Headers, target: URL): void {
  headers.set('host', target.host)
  if (headers.has('origin')) headers.set('origin', target.origin)
  const referer = headers.get('referer')
  if (referer) {
    try {
      const r = new URL(referer)
      headers.set('referer', `${target.origin}${r.pathname}${r.search}`)
    } catch {
      headers.delete('referer')
    }
  }
}

/**
 * The listener's HTTP side, a function of the request and the lookup alone so
 * tests drive it against a stub server without binding this port. The entry
 * path sets the cookie; every other request is forwarded to the cookie's
 * design server and its response streamed back unbuffered.
 */
export async function designPassFetch(req: Request, lookup: DesignLookup): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname === DESIGN_PING_PATH) {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } })
  }
  if (url.pathname.startsWith(DESIGN_OPEN_PREFIX)) {
    return req.method === 'GET' ? open(url) : page(405, 'Not allowed', 'Open the design with a link.')
  }
  const target = targetFor(req, lookup)
  if (!target) return notRunning()

  const headers = withoutHopByHop(req.headers)
  rewriteOrigins(headers, target)
  // Ask for the body as is: fetch would decode a compressed one but keep its
  // `content-encoding`, and the browser would decode it a second time.
  headers.delete('accept-encoding')
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetch(new URL(`${url.pathname}${url.search}`, target), {
      method: req.method,
      headers,
      redirect: 'manual',
      ...(hasBody ? { body: req.body, duplex: 'half' } : {}),
    } as RequestInit)
  } catch {
    return page(502, 'The design server did not answer', 'It may still be starting. Reload in a moment.')
  }

  const out = withoutHopByHop(upstream.headers)
  // A body fetch decoded anyway is no longer the length or encoding it says.
  if (out.has('content-encoding')) {
    out.delete('content-encoding')
    out.delete('content-length')
  }
  // A redirect to the design server's own address stays on this one.
  const location = out.get('location')
  if (location?.startsWith(target.origin)) out.set('location', location.slice(target.origin.length) || '/')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
}

interface PassSocketData {
  /** The design server's WebSocket address: its printed URL's host, this request's path and query. */
  target: string
  origin: string
  protocols: string[]
}

interface PassSocket {
  upstream: WebSocket
  /** What the phone sent before the design server's side opened. */
  pending: (string | ArrayBuffer | Uint8Array)[]
}

const sockets = new WeakMap<ServerWebSocket<PassSocketData>, PassSocket>()

/** A close code a WebSocket may send: the reserved ones (1005, 1006, 1015) become a plain 1000. */
function sendableCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000
}

/**
 * Hot reload: a dev server's page connects a WebSocket to its own host and
 * port, which on the phone is this listener. Frames are piped both ways to the
 * design server, path, query (Vite's token) and subprotocols (`vite-hmr`) kept.
 */
export const designPassWebSocket: WebSocketHandler<PassSocketData> = {
  open(ws) {
    const { target, origin, protocols } = ws.data
    const upstream = new WebSocket(target, { protocols, headers: { origin } })
    upstream.binaryType = 'arraybuffer'
    const socket: PassSocket = { upstream, pending: [] }
    sockets.set(ws, socket)
    upstream.onopen = () => {
      for (const m of socket.pending) upstream.send(m)
      socket.pending = []
    }
    upstream.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
      ws.send(e.data)
    }
    upstream.onclose = (e) => ws.close(sendableCode(e.code), e.reason)
    upstream.onerror = () => ws.close(1011, 'the design server refused the connection')
  },

  message(ws, message) {
    const socket = sockets.get(ws)
    if (!socket) return
    if (socket.upstream.readyState === WebSocket.OPEN) socket.upstream.send(message)
    else socket.pending.push(message)
  },

  close(ws, code, reason) {
    const socket = sockets.get(ws)
    sockets.delete(ws)
    if (socket && socket.upstream.readyState <= WebSocket.OPEN) socket.upstream.close(sendableCode(code), reason)
  },
}

function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

/** Upgrade a WebSocket bound for the cookie's design server; a response when it cannot be. */
function upgrade(req: Request, server: Server<PassSocketData>, lookup: DesignLookup): Response | undefined {
  const target = targetFor(req, lookup)
  if (!target) return notRunning()
  const url = new URL(req.url)
  const ws = new URL(`${url.pathname}${url.search}`, target)
  ws.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
  const protocols = (req.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const accepted = protocols[0]
  const ok = server.upgrade(req, {
    data: { target: ws.toString(), origin: target.origin, protocols },
    ...(accepted ? { headers: { 'sec-websocket-protocol': accepted } } : {}),
  })
  return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
}

/**
 * Start the pass-through beside the main server: loopback only, so Tailscale's
 * proxy is the sole way in, on `serverPort + 2`. A busy port is warned about
 * and skipped — the phone's Design screen is the only thing that needs it, and
 * it must never stop runcastle booting.
 */
export function serveDesignPass(config: RuncastleConfig, lookup: DesignLookup): Server<PassSocketData> | null {
  const port = phoneDesignPort(config)
  try {
    return Bun.serve<PassSocketData>({
      port,
      hostname: SERVE_HOSTNAME,
      idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS,
      fetch(req, server) {
        if (isWebSocketUpgrade(req) && !new URL(req.url).pathname.startsWith(DESIGN_OPEN_PREFIX)) {
          return upgrade(req, server, lookup)
        }
        return designPassFetch(req, lookup)
      },
      websocket: designPassWebSocket,
    })
  } catch (err) {
    console.warn(
      `design pass-through not started: port ${port} is unavailable (${err instanceof Error ? err.message : String(err)}). ` +
        'Designs will not open on the phone until it is free.',
    )
    return null
  }
}
