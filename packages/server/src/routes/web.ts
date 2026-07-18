import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
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

  app.get('*', async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (/^\/(api|mcp|ws|health)(\/|$)/.test(pathname)) return next()

    const filePath = safeJoin(root, pathname)
    if (filePath && isFile(filePath)) {
      return new Response(await readFile(filePath), {
        status: 200,
        headers: { 'content-type': contentType(filePath) },
      })
    }

    return new Response(await readFile(indexHtml), {
      status: 200,
      headers: { 'content-type': MIME['.html'] },
    })
  })
}

/** Mount the built web app iff it exists on disk (production). No-op in dev. */
export function mountWebAppIfBuilt(app: Hono): void {
  const dist = resolveWebDist()
  if (existsSync(join(dist, 'index.html'))) mountWebApp(app, dist)
}
