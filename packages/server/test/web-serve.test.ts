import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountWebApp, resolveWebDist } from '../src/routes/web'

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

describe('resolveWebDist', () => {
  it('honours the RUNCASTLE_WEB_DIST override', () => {
    const prev = process.env.RUNCASTLE_WEB_DIST
    process.env.RUNCASTLE_WEB_DIST = '/tmp/custom-dist'
    try {
      expect(resolveWebDist()).toBe('/tmp/custom-dist')
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
