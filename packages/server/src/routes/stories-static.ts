import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { STORIES_MANIFEST, storiesRoot } from '@runcastle/core/paths'
import { contentType, safeJoin } from './web'

/**
 * The stories port (`config.storiesPort`, decision 13): built story catalogues,
 * served read-only from their own origin so story code — the user's code,
 * compiled by agents, often intercepting network calls by design — runs as a
 * separate site from runcastle and cannot call its API. Static files only:
 *
 *   /features/<featureId>/<path>  →  featureStoriesDir(featureId)
 *   /base/<commit>/<path>         →  baseStoriesDir(commit)
 *
 * Everything else is 404 — no API, no tRPC, no hooks, no WS. Runcastle's own
 * files beside a build (the manifest, the build log) reach the UI through
 * tRPC, never from here. `no-store` because a build is replaced in place.
 */

const FEATURE_ID = /^feat_[A-Za-z0-9_-]+$/
const COMMIT = /^[0-9a-f]{40}$/
const PRIVATE_FILES = new Set([STORIES_MANIFEST, 'build.log'])

const notFound = (): Response =>
  new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } })

function fileKind(path: string): 'file' | 'dir' | null {
  try {
    const s = statSync(path)
    return s.isFile() ? 'file' : s.isDirectory() ? 'dir' : null
  } catch {
    return null
  }
}

/** The pure `(req) => Response` the stories listener runs, over `root` (default {@link storiesRoot}). */
export function createStoriesHandler(root: string = storiesRoot()): (req: Request) => Promise<Response> {
  const base = resolve(root)
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound()
    const [, area, key, ...rest] = new URL(req.url).pathname.split('/')
    let buildDir: string
    if (area === 'features' && key && FEATURE_ID.test(key)) buildDir = join(base, 'features', key)
    else if (area === 'base' && key && COMMIT.test(key)) buildDir = join(base, 'base', key)
    else return notFound()

    let filePath = safeJoin(buildDir, rest.join('/'))
    if (!filePath) return notFound()
    let kind = fileKind(filePath)
    if (kind === 'dir') {
      filePath = join(filePath, 'index.html')
      kind = fileKind(filePath)
    }
    if (kind !== 'file') return notFound()
    const relative = filePath.slice(buildDir.length + 1).toLowerCase()
    if (PRIVATE_FILES.has(relative)) return notFound()

    return new Response(req.method === 'HEAD' ? null : await readFile(filePath), {
      status: 200,
      headers: { 'content-type': contentType(filePath), 'cache-control': 'no-store' },
    })
  }
}
