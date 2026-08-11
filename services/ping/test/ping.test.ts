import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'

/**
 * The usage-signal endpoint, exercised at its only real seam: the exported
 * `fetch` handler, invoked with a plain Request and a stubbed D1 binding. No
 * network, no wrangler, no Cloudflare account — the whole point is that the
 * validation, the per-day upsert, and the two independent failure paths (npm
 * down, D1 down) are observable offline.
 */

const VALID_PING = {
  installId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  version: '0.4.2',
  platform: 'darwin',
}

interface RecordedStatement {
  sql: string
  bindings: unknown[]
}

/** A D1 stub recording every executed statement — optionally a broken one. */
function dbStub(opts: { failing?: boolean } = {}): { statements: RecordedStatement[]; env: Env } {
  const statements: RecordedStatement[] = []
  const db = {
    prepare: (sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        run: async () => {
          if (opts.failing) throw new Error('D1_ERROR: no such table: pings')
          statements.push({ sql, bindings })
          return { success: true }
        },
      }),
    }),
  }
  return { statements, env: { DB: db } as unknown as Env }
}

interface RecordedFetch {
  url: string
  cf?: { cacheTtl?: number; cacheEverything?: boolean }
}

/** Stub the global fetch the handler uses to reach npm; returns the call log. */
function stubNpm(respond: () => Response | Promise<Response>): RecordedFetch[] {
  const calls: RecordedFetch[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { cf?: RecordedFetch['cf'] }) => {
    calls.push({ url: String(input), cf: init?.cf })
    return respond()
  })
  return calls
}

const npmReturning = (version: string) => () =>
  new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

function pingRequest(body: string | object, url = 'https://ping.runcastle.dev/ping'): Request {
  return new Request(url, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /ping', () => {
  it('records the ping and answers with npm’s latest version', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const res = await worker.fetch(pingRequest(VALID_PING), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ latest: '0.9.1' })
    expect(statements).toHaveLength(1)
    const [installId, day, version, platform] = statements[0]!.bindings
    expect(installId).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(version).toBe('0.4.2')
    expect(platform).toBe('darwin')
  })

  it('collapses repeat same-day pings onto one row', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    await worker.fetch(pingRequest(VALID_PING), env)

    expect(statements[0]!.sql).toContain('INSERT INTO pings (install_id, day, version, platform)')
    expect(statements[0]!.sql).toContain('ON CONFLICT (install_id, day) DO UPDATE')
  })

  it('asks npm through a ~5 minute edge cache', async () => {
    const { env } = dbStub()
    const calls = stubNpm(npmReturning('0.9.1'))

    await worker.fetch(pingRequest(VALID_PING), env)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://registry.npmjs.org/runcastle/latest')
    expect(calls[0]!.cf).toEqual({ cacheTtl: 300, cacheEverything: true })
  })
})

describe('rejected requests', () => {
  it('rejects a non-UUID installId without touching D1', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const res = await worker.fetch(pingRequest({ ...VALID_PING, installId: 'not-a-uuid' }), env)

    expect(res.status).toBe(400)
    expect(statements).toEqual([])
  })

  it('rejects an oversized body without touching D1', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const res = await worker.fetch(pingRequest(`{"padding":"${'x'.repeat(2000)}"}`), env)

    expect(res.status).toBe(400)
    expect(statements).toEqual([])
  })

  it('rejects an over-long version or platform without touching D1', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const long = await worker.fetch(pingRequest({ ...VALID_PING, version: 'v'.repeat(65) }), env)
    const wide = await worker.fetch(pingRequest({ ...VALID_PING, platform: 'p'.repeat(33) }), env)

    expect(long.status).toBe(400)
    expect(wide.status).toBe(400)
    expect(statements).toEqual([])
  })

  it('rejects malformed JSON without touching D1', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const res = await worker.fetch(pingRequest('{ not json'), env)

    expect(res.status).toBe(400)
    expect(statements).toEqual([])
  })

  it('serves no route but /ping, and no method but POST', async () => {
    const { statements, env } = dbStub()
    stubNpm(npmReturning('0.9.1'))

    const elsewhere = await worker.fetch(pingRequest(VALID_PING, 'https://ping.runcastle.dev/'), env)
    const wrongMethod = await worker.fetch(
      new Request('https://ping.runcastle.dev/ping', { method: 'GET' }),
      env,
    )

    expect(elsewhere.status).toBe(404)
    expect(wrongMethod.status).toBe(405)
    expect(statements).toEqual([])
  })
})

describe('upstream failures', () => {
  it('still records the ping when npm is unreachable, and fabricates no version', async () => {
    const { statements, env } = dbStub()
    stubNpm(() => {
      throw new Error('network unreachable')
    })

    const res = await worker.fetch(pingRequest(VALID_PING), env)

    expect(res.ok).toBe(false)
    expect(await res.text()).not.toContain('latest')
    expect(statements).toHaveLength(1)
  })

  it('fabricates no version when npm answers non-2xx or garbage', async () => {
    const { env } = dbStub()
    stubNpm(() => new Response('upstream is having a day', { status: 503 }))
    expect((await worker.fetch(pingRequest(VALID_PING), env)).ok).toBe(false)

    vi.unstubAllGlobals()
    stubNpm(() => new Response('<html>not json</html>', { status: 200 }))
    expect((await worker.fetch(pingRequest(VALID_PING), env)).ok).toBe(false)
  })

  it('still answers with latest when the D1 write fails', async () => {
    const { statements, env } = dbStub({ failing: true })
    stubNpm(npmReturning('0.9.1'))

    const res = await worker.fetch(pingRequest(VALID_PING), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ latest: '0.9.1' })
    expect(statements).toEqual([])
  })
})
