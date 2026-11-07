import { closeSync, copyFileSync, mkdirSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { newId, type SessionRow, type ShownAs, type ShownFile } from '@runcastle/core'
import { dataDir, projectWorktreesDir, sessionDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { getSessionRow } from '../launcher/sessions'
import { getFeatureRow, listSessionsByFeature, requireProjectById } from '../services/repo'
import { appendThreadEvent, hasThreadLog, readThreadEvents } from './log'
import { seedFromTranscript } from './read'

/**
 * Files an agent shows in its chat (agents-show-files-in-chat). `show_file`
 * copies the file beside the thread's log (`<sessionDir>/shown/<id>.<ext>`), so
 * the chat keeps working after merge deletes the worktree, and logs one event
 * naming the copy. Served by `routes/threads.ts`, which only ever reaches a name
 * this store minted: no URL carries a path.
 */

/** Past this a file is refused: it is a dump copied by mistake, not something to look at. */
export const SHOWN_MAX_BYTES = 100_000_000

/** The types a browser shows as media, by stored extension. Everything else is served as a download. */
export const SHOWN_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
}

/** A stored copy's name: an id this server minted and a short extension, nothing else. */
const SHOWN_FILE = /^[A-Za-z0-9_-]+\.[a-z0-9]{1,10}$/
const THREAD_ID = /^[A-Za-z0-9_-]+$/

/** How much of a file is read to tell text from binary. */
const SNIFF_BYTES = 8192

/** Where a thread's copy is served from. */
function shownUrl(threadId: string, file: string): string {
  return `/api/threads/${threadId}/files/${file}`
}

/** The stored copy `file` of a thread, or null for a name this store never writes. */
export function shownFilePath(threadId: string, file: string): string | null {
  if (!THREAD_ID.test(threadId) || !SHOWN_FILE.test(file)) return null
  return join(sessionDir(threadId), 'shown', file)
}

/** What a file is: by its extension, then by whether its start holds a NUL byte. */
export function sortFile(ext: string, head: Uint8Array): ShownAs {
  const type = SHOWN_TYPES[ext]
  if (type?.startsWith('image/')) return 'image'
  if (type) return 'browser'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  return head.includes(0) ? 'download' : 'text'
}

function readHead(path: string): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const head = new Uint8Array(SNIFF_BYTES)
    return head.subarray(0, readSync(fd, head, 0, SNIFF_BYTES, 0))
  } finally {
    closeSync(fd)
  }
}

/** `path` with its links followed, or null where it does not exist. */
function realPath(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** The project a session belongs to, whichever way its row says so. */
function sessionProjectId(ctx: AppCtx, session: SessionRow): string {
  if (session.projectId) return session.projectId
  if (session.featureId) return getFeatureRow(ctx, session.featureId).projectId
  throw new GateError(`session ${session.id} belongs to no project`)
}

/** A copy already shown in one of this project's threads, which may be shown again. */
function isShownCopy(ctx: AppCtx, projectId: string, path: string): boolean {
  const sessions = realPath(join(dataDir(), 'sessions'))
  if (!sessions || !isInside(sessions, path)) return false
  const [threadId, folder, file, ...rest] = relative(sessions, path).split(/[\\/]/)
  if (folder !== 'shown' || !file || rest.length > 0) return false
  const row = getSessionRow(ctx, threadId)
  return !!row && sessionProjectId(ctx, row) === projectId
}

/** Whether a file, its links already followed, sits somewhere an agent may show from. */
function mayShow(ctx: AppCtx, session: SessionRow, path: string): boolean {
  const projectId = sessionProjectId(ctx, session)
  const roots = [
    session.worktreePath,
    requireProjectById(ctx, projectId).repoPath,
    projectWorktreesDir(projectId),
    join(dataDir(), 'reviews'),
    tmpdir(),
  ]
  return roots.some((root) => {
    const real = realPath(root)
    return real !== null && isInside(real, path)
  }) || isShownCopy(ctx, projectId, path)
}

/** The extension a copy is stored under: the file's own when it is short and plain. */
export function storedExt(name: string): string {
  const ext = extname(name).slice(1).toLowerCase()
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin'
}

/**
 * A file an agent's tool may copy out to show: `path` (relative to the
 * session's worktree) resolved, its links followed, inside the places agents
 * may show from, and under the size cap. `tool` names the asking tool in every
 * refusal, a sentence the agent can act on.
 */
export function showableFile(
  ctx: AppCtx,
  session: SessionRow,
  path: string,
  tool: string,
): { full: string; real: string; size: number } {
  const full = resolve(session.worktreePath, path)
  const real = realPath(full)
  if (!real) throw new GateError(`there is no file at ${full}`)
  const stat = statSync(real)
  if (!stat.isFile()) throw new GateError(`${full} is not a file: ${tool} shows one file, not a folder`)
  if (!mayShow(ctx, session, real)) {
    throw new GateError(
      `${full} is outside the places ${tool} reads from: this project, its worktrees, review ` +
        'evidence, files already shown, and the temp folder. Copy it to the temp folder if the human asked to see it',
    )
  }
  if (stat.size > SHOWN_MAX_BYTES) {
    throw new GateError(`${full} is ${Math.ceil(stat.size / 1_000_000)} MB, and ${tool} takes at most 100 MB`)
  }
  return { full, real, size: stat.size }
}

/**
 * Show one file in the session's thread: check it, copy it, log it. Every refusal
 * is a sentence the agent can act on, and a refused file leaves nothing behind.
 */
export function showFile(
  ctx: AppCtx,
  session: SessionRow,
  input: { path: string; caption?: string | undefined },
): { shown: true; name: string; as: ShownAs } {
  const { full, real, size } = showableFile(ctx, session, input.path, 'show_file')
  const inWorktree = isInside(resolve(session.worktreePath), full)
  return logShown(ctx, session.id, {
    real,
    name: basename(full),
    path: inWorktree ? relative(session.worktreePath, full).replaceAll('\\', '/') : full,
    size,
    caption: input.caption,
  })
}

/**
 * Show a file runcastle itself fetched from where the session's agent runs (a
 * worker's sandbox, interactive-workers decision 9): `file` is runcastle's own
 * copy on the host, `path` the name the agent knows it by. Only the size cap
 * applies: the places check guards the host's disk, and this copy is runcastle's.
 */
export function showFetchedFile(
  ctx: AppCtx,
  sessionId: string,
  input: { file: string; path: string; caption?: string | undefined },
): { shown: true; name: string; as: ShownAs } {
  const size = statSync(input.file).size
  if (size > SHOWN_MAX_BYTES) {
    throw new GateError(`${input.path} is ${Math.ceil(size / 1_000_000)} MB, and show_file takes at most 100 MB`)
  }
  return logShown(ctx, sessionId, { real: input.file, name: basename(input.path), path: input.path, size, caption: input.caption })
}

/** Copy a checked file beside the thread's log and log it as shown. */
function logShown(
  ctx: AppCtx,
  sessionId: string,
  input: { real: string; name: string; path: string; size: number; caption?: string | undefined },
): { shown: true; name: string; as: ShownAs } {
  const { real, name, size } = input
  const ext = storedExt(name)
  const as = sortFile(ext, readHead(real))
  const file = `${newId('file')}.${ext}`
  const dir = join(sessionDir(sessionId), 'shown')
  mkdirSync(dir, { recursive: true })
  copyFileSync(real, join(dir, file))

  const caption = input.caption?.replace(/\s+/g, ' ').trim()
  const shown: ShownFile = {
    id: file.slice(0, -ext.length - 1),
    src: shownUrl(sessionId, file),
    name,
    path: input.path,
    size,
    as,
    ...(caption ? { caption } : {}),
  }
  // A conversation from before logs reads back from its transcript until it has one.
  seedFromTranscript(ctx, sessionId)
  appendThreadEvent(sessionId, { type: 'file_shown', file: shown })
  return { shown: true, name, as }
}

/** A file a feature's chat showed, as the orchestrator is told about it. */
export interface ShownCopy {
  name: string
  caption?: string
  /** The copy itself, which `show_file` can show again in another thread. */
  path: string
}

/** How many of a chat's shown files the orchestrator is told about: the newest. */
const SHOWN_COPIES_MAX = 20

const SHOWN_SRC = /^\/api\/threads\/([^/]+)\/files\/([^/]+)$/

/** The files a feature's main chats showed, newest last. */
export function shownCopies(ctx: AppCtx, featureId: string): ShownCopy[] {
  const events = listSessionsByFeature(ctx, featureId)
    .filter((row) => row.kind === 'chat' && hasThreadLog(row.id))
    .flatMap((row) => readThreadEvents(row.id))
    .flatMap((e) => (e.type === 'file_shown' ? [{ at: e.at, file: e.file }] : []))
  return events
    .sort((a, b) => a.at - b.at)
    .slice(-SHOWN_COPIES_MAX)
    .flatMap(({ file }) => {
      const [, threadId, stored] = SHOWN_SRC.exec(file.src) ?? []
      const path = threadId && stored ? shownFilePath(threadId, stored) : null
      return path ? [{ name: file.name, ...(file.caption ? { caption: file.caption } : {}), path }] : []
    })
}
