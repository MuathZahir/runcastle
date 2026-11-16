import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib'
import type { Hono } from 'hono'

/**
 * Production SPA hosting (issue #38, workstream G). In production the server
 * serves the built web app (`apps/web/dist`) alongside the API from one origin
 * on one port, so `runcastle` is a single command and a single URL. Contributor
 * dev mode is unaffected: there the SPA is served by Vite (4513) which proxies
 * `/api` + `/ws` to the server, and this catch-all is a no-op because the dist
 * dir does not exist (it is never mounted).
 *
 * Uses `node:fs` rather than `hono/bun`'s serveStatic so the handler is
 * runtime-agnostic (Bun implements node:fs) and testable under the node/vitest
 * suite. The app is a single-screen workspace with no client routes, so any
 * unmatched non-asset GET falls back to `index.html`.
 *
 * Fast over a slow link (a-faster-web-app): each file is read and compressed
 * ONCE (brotli and gzip, picked per request from Accept-Encoding) and kept in
 * memory; a stat per request notices a rebuilt file and redoes it. Vite's
 * hashed `/assets/*` never change under one name, so they are cached forever;
 * everything else (the page itself, the service worker, the favicon) is
 * `no-cache` with an ETag, so a plain refresh after a runcastle update asks
 * again, and gets a 304 when nothing changed.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
}

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Already-compressed formats: compressing them again costs CPU and saves nothing. */
const PRECOMPRESSED = new Set(['.woff', '.woff2', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'])

/** Below this a compressed body saves less than it costs. */
const MIN_COMPRESS_BYTES = 1024

/** Hashed build output: a new build writes a new name, so a name never changes. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
/** Everything else: the browser may keep it, but asks (cheaply, by ETag) every time. */
export const REVALIDATE = 'no-cache'

const brotliAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/** One file as served: its bytes in every encoding worth sending. */
interface Prepared {
  mtimeMs: number
  size: number
  etag: string
  type: string
  raw: Uint8Array
  br?: Uint8Array
  gzip?: Uint8Array
}

async function prepare(path: string, mtimeMs: number, size: number): Promise<Prepared> {
  const raw = new Uint8Array(await readFile(path))
  const etag = `"${createHash('sha1').update(raw).digest('base64url').slice(0, 22)}"`
  const prepared: Prepared = { mtimeMs, size, etag, type: contentType(path), raw }
  if (raw.byteLength < MIN_COMPRESS_BYTES || PRECOMPRESSED.has(extname(path).toLowerCase())) return prepared
  // Async zlib works off the main thread, so a first compression never stalls
  // other requests. Brotli's top quality is slow, but it is paid once per file.
  const [br, gz] = await Promise.all([
    brotliAsync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
      },
    }),
    gzipAsync(raw, { level: 9 }),
  ])
  if (br.byteLength < raw.byteLength) prepared.br = new Uint8Array(br)
  if (gz.byteLength < raw.byteLength) prepared.gzip = new Uint8Array(gz)
  return prepared
}

/** The encodings a request accepts, honouring `;q=0` refusals. */
function acceptedEncodings(header: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!header) return out
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (q && Number(q.slice(2)) === 0) continue
    if (name) out.add(name.trim())
  }
  return out
}

/** Does `If-None-Match` name this tag (or `*`)? A weak form matches too (RFC 9110 weak comparison). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some((t) => {
    const tag = t.trim()
    return tag === '*' || tag === etag || tag === `W/${etag}`
  })
}

/** Join under `root`, rejecting anything that escapes it (path traversal). */
function safeJoin(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const joined = normalize(join(root, decoded))
  if (joined !== root && !joined.startsWith(root + sep)) return null
  return joined
}

/**
 * Resolve the built web app directory. `RUNCASTLE_WEB_DIST` overrides the
 * default `apps/web/dist` (four levels up from this file at the repo root).
 */
export function resolveWebDist(): string {
  const override = process.env.RUNCASTLE_WEB_DIST
  if (override) return resolve(override)
  return resolve(import.meta.dirname, '..', '..', '..', '..', 'apps', 'web', 'dist')
}

/**
 * Mount a catch-all that serves static files from `distDir`, falling back to
 * `index.html` for SPA routes. Register AFTER the API/hooks/MCP routes so those
 * win; server-owned prefixes reaching here are genuine misses and are passed
 * through (→ 404) rather than masked with the SPA shell.
 */
export function mountWebApp(app: Hono, distDir: string): void {
  const root = resolve(distDir)
  const indexHtml = join(root, 'index.html')
  const assetsDir = join(root, 'assets')
  const cache = new Map<string, Promise<Prepared>>()

  /** The file at `path` as served, or null when there is no such file. */
  const load = async (path: string): Promise<Prepared | null> => {
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(path)
    } catch {
      return null
    }
    if (!st.isFile()) return null
    const hit = cache.get(path)
    if (hit) {
      const p = await hit.catch(() => null)
      // A rebuilt file (same name, new bytes) is prepared again.
      if (p && p.mtimeMs === st.mtimeMs && p.size === st.size) return p
    }
    const next = prepare(path, st.mtimeMs, st.size)
    cache.set(path, next)
    next.catch(() => cache.delete(path))
    return next
  }

  // Warm the cache in the background, so the first visitor after a start does
  // not wait on brotli: the page and every built asset.
  const warm = [indexHtml]
  try {
    for (const name of readdirSync(assetsDir)) warm.push(join(assetsDir, name))
  } catch {
    // No assets dir: only the page to warm.
  }
  for (const path of warm) void load(path).catch(() => undefined)

  app.get('*', async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (/^\/(api|mcp|ws|health)(\/|$)/.test(pathname)) return next()

    const filePath = safeJoin(root, pathname)
    let path = filePath
    let file = filePath ? await load(filePath) : null
    // A missing hashed asset is a real miss, never the page: a tab opened before
    // an update asks for its old chunks by name, and the HTML shell under a
    // script's name fails in a way the app cannot tell from a broken build.
    if (!file && pathname.startsWith('/assets/')) return c.notFound()
    if (!file) {
      path = indexHtml
      file = await load(indexHtml)
    }
    if (!file || !path) return next()

    const headers: Record<string, string> = {
      'content-type': file.type,
      'cache-control': path.startsWith(assetsDir + sep) ? IMMUTABLE : REVALIDATE,
      etag: file.etag,
    }
    if (file.br || file.gzip) headers.vary = 'Accept-Encoding'

    if (matchesEtag(c.req.header('if-none-match'), file.etag)) {
      return new Response(null, { status: 304, headers })
    }

    const accepts = acceptedEncodings(c.req.header('accept-encoding'))
    let body = file.raw
    if (file.br && accepts.has('br')) {
      body = file.br
      headers['content-encoding'] = 'br'
    } else if (file.gzip && accepts.has('gzip')) {
      body = file.gzip
      headers['content-encoding'] = 'gzip'
    }
    return new Response(body, { status: 200, headers })
  })
}

/** Mount the built web app iff it exists on disk (production). No-op in dev. */
export function mountWebAppIfBuilt(app: Hono): void {
  const dist = resolveWebDist()
  if (existsSync(join(dist, 'index.html'))) mountWebApp(app, dist)
}
