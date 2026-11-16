import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { IMMUTABLE, mountWebApp, REVALIDATE, resolveWebDist } from '../src/routes/web'

/**
 * Issue #38 — the server serves the built SPA + API from one origin. Exercises
 * `mountWebApp` over a fake `dist/`: real assets are served with correct MIME,
 * unknown non-asset paths fall back to `index.html` (SPA), server-owned prefixes
 * pass through to a 404 (not the SPA shell), and traversal is refused.
 */
describe('mountWebApp (SPA hosting)', () => {
  let dist: string
  let app: Hono

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'runcastle-web-'))
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>runcastle</title>')
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')

    app = new Hono()
    app.get('/api/health', (c) => c.json({ ok: true }))
    mountWebApp(app, dist)
  })

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true })
  })

  it('serves index.html at the root', async () => {
    const res = await app.fetch(new Request('http://x/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('runcastle')
  })

  it('serves built assets with the right content-type', async () => {
    const res = await app.fetch(new Request('http://x/assets/app.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('falls back to index.html for unknown SPA routes', async () => {
    const res = await app.fetch(new Request('http://x/features/some-slug'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('runcastle')
  })

  it('does not mask API/server routes with the SPA shell', async () => {
    const ok = await app.fetch(new Request('http://x/api/health'))
    expect(await ok.json()).toEqual({ ok: true })

    const miss = await app.fetch(new Request('http://x/api/does-not-exist'))
    expect(miss.status).toBe(404)
    expect(await miss.text()).not.toContain('<title>runcastle</title>')
  })

  it('refuses path traversal outside the dist root', async () => {
    const res = await app.fetch(new Request('http://x/assets/..%2f..%2f..%2fetc%2fpasswd'))
    // Escaping paths never resolve to a file; the SPA fallback is served instead.
    expect(await res.text()).toContain('runcastle')
  })
})

/**
 * a-faster-web-app: the app's files are compressed once and cached, so a refresh
 * over a slow tunnel downloads the page alone (or nothing), not the whole app.
 */
describe('mountWebApp (compression and caching)', () => {
  let dist: string
  let app: Hono
  const bigJs = `export const words = ${JSON.stringify('runcastle '.repeat(2000))}\n`

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'runcastle-web-'))
    writeFileSync(join(dist, 'index.html'), `<!doctype html><title>runcastle</title>${'<!-- pad -->'.repeat(200)}`)
    writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("push", () => {})')
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), bigJs)
    writeFileSync(join(dist, 'assets', 'font-abc123.woff2'), Buffer.alloc(4096, 7))
    app = new Hono()
    mountWebApp(app, dist)
  })

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true })
  })

  const get = (path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`http://x${path}`, { headers }))

  it('caches hashed assets forever', async () => {
    const res = await get('/assets/index-abc123.js')
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(res.headers.get('etag')).toBeTruthy()
  })

  it('makes the page, the SPA fallback and root files revalidate', async () => {
    for (const path of ['/', '/index.html', '/features/some-slug', '/sw.js']) {
      const res = await get(path)
      expect(res.headers.get('cache-control'), path).toBe(REVALIDATE)
      expect(res.headers.get('etag'), path).toMatch(/^".+"$/)
    }
  })

  it('sends brotli when accepted, else gzip, else plain', async () => {
    const br = await get('/assets/index-abc123.js', { 'accept-encoding': 'gzip, deflate, br' })
    expect(br.headers.get('content-encoding')).toBe('br')
    expect(br.headers.get('vary')).toBe('Accept-Encoding')
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(bigJs)

    const gz = await get('/assets/index-abc123.js', { 'accept-encoding': 'gzip' })
    expect(gz.headers.get('content-encoding')).toBe('gzip')
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(bigJs)

    const refused = await get('/assets/index-abc123.js', { 'accept-encoding': 'br;q=0, gzip' })
    expect(refused.headers.get('content-encoding')).toBe('gzip')

    const plain = await get('/assets/index-abc123.js')
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(await plain.text()).toBe(bigJs)
  })

  it('compresses the page too', async () => {
    const res = await get('/', { 'accept-encoding': 'br' })
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toContain('<title>runcastle</title>')
  })

  it('does not compress fonts again', async () => {
    const res = await get('/assets/font-abc123.woff2', { 'accept-encoding': 'br, gzip' })
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-type')).toBe('font/woff2')
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect((await res.arrayBuffer()).byteLength).toBe(4096)
  })

  it('answers 304 when the tag still matches', async () => {
    const first = await get('/')
    const etag = first.headers.get('etag') ?? ''
    const again = await get('/', { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('etag')).toBe(etag)
    expect(again.headers.get('cache-control')).toBe(REVALIDATE)

    const fallback = await get('/features/x', { 'if-none-match': `W/${etag}` })
    expect(fallback.status).toBe(304)
  })

  it('serves a rebuilt page on a plain refresh (an update shows)', async () => {
    const before = await get('/')
    const etag = before.headers.get('etag') ?? ''
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>runcastle v2</title>')
    // A new mtime is not guaranteed within the same clock tick; the size differs regardless.
    const after = await get('/', { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(etag)
    expect(await after.text()).toContain('runcastle v2')
  })
})

describe('resolveWebDist', () => {
  it('honours the RUNCASTLE_WEB_DIST override', () => {
    const prev = process.env.RUNCASTLE_WEB_DIST
    // Use an already-resolved absolute path so the assertion is host-independent:
    // resolveWebDist() runs the override through node:path.resolve, which rewrites
    // a POSIX-absolute literal to a drive path on Windows (issue #54).
    const custom = resolve('custom-dist')
    process.env.RUNCASTLE_WEB_DIST = custom
    try {
      expect(resolveWebDist()).toBe(custom)
    } finally {
      if (prev === undefined) delete process.env.RUNCASTLE_WEB_DIST
      else process.env.RUNCASTLE_WEB_DIST = prev
    }
  })

  it('defaults to apps/web/dist at the repo root', () => {
    const prev = process.env.RUNCASTLE_WEB_DIST
    delete process.env.RUNCASTLE_WEB_DIST
    try {
      expect(resolveWebDist().replace(/\\/g, '/')).toMatch(/\/apps\/web\/dist$/)
    } finally {
      if (prev !== undefined) process.env.RUNCASTLE_WEB_DIST = prev
    }
  })
})
