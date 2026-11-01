import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DESIGN_COOKIE, designPassFetch } from '../src/routes/design-pass'
import { resolveBun } from './helpers/bun'

/**
 * The design pass-through (routes/design-pass.ts), the phone's way to a
 * feature's design server. HTTP is driven through `designPassFetch` against a
 * plain node HTTP server that, like Vite, refuses any Host but its own; the
 * listener and its WebSocket piping need Bun, so they run in a spawned fixture.
 */

const TAILNET_HOST = 'desk.tail1234.ts.net:4514'
const PASS = `http://${TAILNET_HOST}`

interface Seen {
  method: string
  url: string
  host?: string
  origin?: string
  referer?: string
  body: string
}

let stub: Server
let printed: string
const seen: Seen[] = []
/** Ends the streaming response the test holds open. */
let finishStream: (() => void) | undefined

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => (body += c))
    req.on('end', () => resolve(body))
  })
}

beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const body = await readBody(req)
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      ...(req.headers.host ? { host: req.headers.host } : {}),
      ...(req.headers.origin ? { origin: req.headers.origin } : {}),
      ...(req.headers.referer ? { referer: req.headers.referer } : {}),
      body,
    })
    const own = `localhost:${(stub.address() as AddressInfo).port}`
    if (req.headers.host !== own) {
      res.writeHead(403).end('Blocked request. This host is not allowed.')
    } else if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('first ')
      finishStream = () => res.end('last')
    } else if (req.url === '/moved') {
      res.writeHead(302, { location: `http://${own}/preview/x.html` }).end()
    } else {
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<p>${req.method} ${req.url}</p>`)
    }
  })
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  printed = `http://localhost:${(stub.address() as AddressInfo).port}/`
})

afterAll(() => {
  finishStream?.()
  stub.close()
})

const lookup = (featureId: string) => (featureId === 'feat' ? printed : undefined)
const withCookie = (path: string, init: RequestInit = {}) =>
  new Request(`${PASS}${path}`, {
    ...init,
    headers: { host: TAILNET_HOST, cookie: `other=1; ${DESIGN_COOKIE}=feat`, ...(init.headers as Record<string, string>) },
  })

describe('the entry path', () => {
  it('remembers the feature in a cookie and goes to the page asked for', async () => {
    const res = await designPassFetch(new Request(`${PASS}/__runcastle/open/feat?path=/preview/x.html?a=1`), lookup)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/preview/x.html?a=1')
    expect(res.headers.get('set-cookie')).toBe(`${DESIGN_COOKIE}=feat; Path=/; HttpOnly; SameSite=Lax; Secure`)
  })

  it.each(['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'preview/x.html'])(
    'refuses a path that leaves the site: %s',
    async (path) => {
      const res = await designPassFetch(
        new Request(`${PASS}/__runcastle/open/feat?path=${encodeURIComponent(path)}`),
        lookup,
      )
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('set-cookie')).toBeNull()
    },
  )
})

describe('forwarding', () => {
  it('returns the page, not the blocked-host 403, for a request from the tailnet', async () => {
    const res = await designPassFetch(
      withCookie('/preview/x.html?v=2', {
        headers: { origin: `https://${TAILNET_HOST}`, referer: `https://${TAILNET_HOST}/preview/` },
      }),
      lookup,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>GET /preview/x.html?v=2</p>')
    const port = new URL(printed).port
    expect(seen.at(-1)).toMatchObject({
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
      referer: `http://localhost:${port}/preview/`,
    })
  })

  it('forwards the method and body', async () => {
    const res = await designPassFetch(withCookie('/api/save', { method: 'POST', body: 'hello' }), lookup)
    expect(await res.text()).toBe('<p>POST /api/save</p>')
    expect(seen.at(-1)).toMatchObject({ method: 'POST', body: 'hello' })
  })

  it('streams the response rather than waiting for its end', async () => {
    const res = await designPassFetch(withCookie('/stream'), lookup)
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('first ')
    finishStream?.()
    let rest = ''
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value)
    expect(rest).toBe('last')
  })

  it('keeps a redirect to the design server’s own address on the pass-through', async () => {
    const res = await designPassFetch(withCookie('/moved'), lookup)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/preview/x.html')
  })
})

describe('nothing to forward to', () => {
  it('says the design server is not running when there is no cookie', async () => {
    const res = await designPassFetch(new Request(`${PASS}/preview/x.html`), lookup)
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('The design server is not running')
  })

  it('says so when the feature’s server is stopped', async () => {
    const res = await designPassFetch(
      new Request(`${PASS}/`, { headers: { cookie: `${DESIGN_COOKIE}=other` } }),
      lookup,
    )
    expect(res.status).toBe(503)
  })

  it('answers at once when the printed address no longer answers', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const gone = `http://localhost:${(closed.address() as AddressInfo).port}/`
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    const res = await designPassFetch(withCookie('/'), () => gone)
    expect(res.status).toBe(502)
    expect(await res.text()).toContain('did not answer')
  })
})

const BUN = resolveBun()
const FIXTURE = fileURLToPath(new URL('./fixtures/design-pass-bun.ts', import.meta.url))

interface FixtureResult {
  hostname: string
  port: number
  expectedPort: number
  socket: { protocol: string; received: string[] } | { error: string }
  busyStarted: boolean
  busyWarned: boolean
}

describe.skipIf(BUN === null)('the listener, under Bun', () => {
  let result: FixtureResult
  beforeAll(async () => {
    const child = spawn(BUN ?? 'bun', [FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (c: Buffer) => (out += c.toString()))
    child.stderr.on('data', (c: Buffer) => (err += c.toString()))
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const line = out.trim().split('\n').at(-1)
    if (!line) throw new Error(`fixture printed nothing; stderr:\n${err}`)
    result = JSON.parse(line) as FixtureResult
  }, 30_000)

  it('binds loopback only, on serverPort + 2', () => {
    expect(result.hostname).toBe('127.0.0.1')
    expect(result.port).toBe(result.expectedPort)
  })

  it('pipes a vite-hmr WebSocket both ways, token and subprotocol kept', () => {
    expect(result.socket).toEqual({
      protocol: 'vite-hmr',
      received: ['{"type":"connected","token":"abc"}', 'update:src/main.ts'],
    })
  })

  it('warns and carries on when its port is busy', () => {
    expect(result.busyStarted).toBe(false)
    expect(result.busyWarned).toBe(true)
  })
})
