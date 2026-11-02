/**
 * Bun-side half of `design-pass.test.ts`: the pass-through's listener and its
 * WebSocket piping need `Bun.serve`, which the node test runner lacks. Starts a
 * stub design server that behaves like Vite where it matters — refuses a Host
 * that is not its own, and accepts the hot-reload socket only with subprotocol
 * `vite-hmr` and its token — puts `serveDesignPass` in front of it, drives one
 * socket through, then tries the listener on a busy port. Prints one JSON line.
 */
import type { RuncastleConfig } from '@runcastle/core'
import { DESIGN_COOKIE, serveDesignPass } from '../../src/routes/design-pass'

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = probe.port ?? 0
  void probe.stop(true)
  return port
}

const upstream = Bun.serve<{ token: string }>({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req, server) {
    const url = new URL(req.url)
    if (req.headers.get('host') !== `localhost:${server.port}`) return new Response('Blocked request', { status: 403 })
    if (req.headers.get('upgrade') === 'websocket') {
      if (req.headers.get('sec-websocket-protocol') !== 'vite-hmr' || !url.searchParams.get('token')) {
        return new Response('bad socket', { status: 400 })
      }
      const ok = server.upgrade(req, {
        data: { token: url.searchParams.get('token') ?? '' },
        headers: { 'sec-websocket-protocol': 'vite-hmr' },
      })
      return ok ? undefined : new Response('upgrade failed', { status: 400 })
    }
    return new Response('page')
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: 'connected', token: ws.data.token }))
    },
    message(ws, message) {
      ws.send(`update:${String(message)}`)
    },
  },
})

const printed = `http://localhost:${upstream.port}/`
const lookup = (featureId: string) => (featureId === 'feat' ? printed : undefined)
const serverPort = freePort() - 2
const config = { serverPort } as RuncastleConfig
const pass = serveDesignPass(config, lookup)

async function socketThrough(): Promise<{ protocol: string; received: string[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${pass?.port}/?token=abc`, {
    protocols: ['vite-hmr'],
    headers: { cookie: `${DESIGN_COOKIE}=feat` },
  })
  const received: string[] = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(received)}`)), 5000)
    ws.onmessage = (e) => {
      received.push(String(e.data))
      if (received.length === 1) ws.send('src/main.ts')
      else {
        clearTimeout(timer)
        resolve({ protocol: ws.protocol, received })
        ws.close()
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('socket error'))
    }
  })
}

const busy = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('taken') })
const warnings: string[] = []
console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
const onBusy = serveDesignPass({ serverPort: (busy.port ?? 0) - 2 } as RuncastleConfig, lookup)

const result = {
  hostname: pass?.hostname,
  port: pass?.port,
  expectedPort: serverPort + 2,
  socket: await socketThrough().catch((e: unknown) => ({ error: String(e) })),
  busyStarted: onBusy !== null,
  busyWarned: warnings.some((w) => w.includes(String(busy.port))),
}
console.log(JSON.stringify(result))
await pass?.stop(true)
await busy.stop(true)
await upstream.stop(true)
process.exit(0)
