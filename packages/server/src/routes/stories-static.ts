import { realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PROJECT_ID_PATTERN } from '@runcastle/core'
import {
  MAIN_CATALOGUE_ATTEMPT,
  MAIN_CATALOGUE_RECORD,
  STORIES_MANIFEST,
  storiesRoot,
} from '@runcastle/core/paths'
import { FEATURE_ID_PATTERN } from '../services/ui-states'
import { STORIES_BASE_LOG, STORIES_BUILD_LOG } from '../workflows/stories-build'
import { contentType, safeJoin } from './web'

/**
 * The stories port (`config.storiesPort`, decision 13): built story catalogues,
 * served read-only from their own origin so story code — the user's code,
 * compiled by agents, often intercepting network calls by design — runs as a
 * separate site from runcastle and cannot call its API. Static files only:
 *
 *   /features/<featureId>/<path>  →  featureStoriesDir(featureId)
 *   /base/<commit>/<path>         →  baseStoriesDir(commit)
 *   /main/<projectId>/<path>      →  mainStoriesDir(projectId)
 *
 * Everything else is 404 — no API, no tRPC, no hooks, no WS, and never main's
 * in-flight attempts (`main-attempts/`). Runcastle's own files beside a build
 * (the manifest, main's record and attempt, the build logs) are never served
 * from here; what the UI needs of them comes through tRPC. `no-store` because
 * a build is replaced in place.
 */

const COMMIT = /^[0-9a-f]{40}$/
const PRIVATE_FILES = new Set([
  STORIES_MANIFEST,
  STORIES_BUILD_LOG,
  STORIES_BASE_LOG,
  MAIN_CATALOGUE_RECORD,
  MAIN_CATALOGUE_ATTEMPT,
])

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

export interface StoriesHandlerDeps {
  /** Resolves a path to its real long name (default `realpathSync.native`); injectable so a test can stand in for Windows 8.3 aliases. */
  realPath?: (path: string) => string
}

/** The pure `(req) => Response` the stories listener runs, over `root` (default {@link storiesRoot}). */
export function createStoriesHandler(
  root: string = storiesRoot(),
  deps: StoriesHandlerDeps = {},
): (req: Request) => Promise<Response> {
  const base = resolve(root)
  const realPath = deps.realPath ?? realpathSync.native
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound()
    const [, area, key, ...rest] = new URL(req.url).pathname.split('/')
    const keyOk =
      key !== undefined &&
      ((area === 'features' && FEATURE_ID_PATTERN.test(key)) ||
        (area === 'base' && COMMIT.test(key)) ||
        (area === 'main' && PROJECT_ID_PATTERN.test(key)))
    if (!keyOk) return notFound()
    const buildDir = join(base, area, key)

    let filePath = safeJoin(buildDir, rest.join('/'))
    if (!filePath) return notFound()
    let kind = fileKind(filePath)
    if (kind === 'dir') {
      filePath = join(filePath, 'index.html')
      kind = fileKind(filePath)
    }
    if (kind !== 'file') return notFound()
    // Compare real long names: on Windows an 8.3 alias (`MANIFE~1.JSO`) stats
    // as the manifest itself, so the requested spelling proves nothing.
    let real: string
    try {
      real = relative(realPath(buildDir), realPath(filePath))
    } catch {
      return notFound()
    }
    if (real === '' || real === '..' || real.startsWith(`..${sep}`) || isAbsolute(real)) return notFound()
    const name = real.split(sep).join('/').toLowerCase()
    // A colon is NTFS's stream separator: `manifest.json::$DATA` is the
    // manifest itself. No build writes one, so refuse it outright.
    if (name.includes(':') || PRIVATE_FILES.has(name)) return notFound()

    return new Response(req.method === 'HEAD' ? null : await readFile(filePath), {
      status: 200,
      headers: { 'content-type': contentType(filePath), 'cache-control': 'no-store' },
    })
  }
}
