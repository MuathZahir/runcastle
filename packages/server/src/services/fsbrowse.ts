import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { InvalidInputError } from '../errors'

/**
 * Filesystem browse service — the data behind the repo picker (the "paste an
 * absolute path" box was the only way to open a project).
 *
 * This is deliberately *server*-side. apps/web is a browser UI with no Electron
 * or Tauri shell (CONTEXT.md: "Tauri-wrappable later"), and a browser cannot
 * hand JS a real absolute path: `<input type="file" webkitdirectory>` yields
 * sandboxed relative names and `showDirectoryPicker` yields an opaque handle.
 * Since the Bun server runs on the user's machine and every path the rest of
 * runcastle touches (git, worktrees, PTYs) resolves against *its* filesystem,
 * the picker must browse the server's filesystem for the paths to mean anything.
 *
 * Cross-platform notes: roots are drive letters on Windows and `/` on POSIX;
 * every path is built with `node:path` (SPEC §12) and returned absolute, so the
 * client stays free of platform branching — it renders `crumbs`/`entries` and
 * echoes `path` values back verbatim.
 */

/** One navigable directory in a listing. */
export interface DirEntry {
  name: string
  /** Absolute, platform-native path. */
  path: string
  /** True when the directory looks like a git repo (has a `.git` entry). */
  isRepo: boolean
  /** True when the entry is a symlink that resolves to a directory. */
  isSymlink: boolean
}

/** A clickable path segment (cumulative prefix of the current directory). */
export interface Crumb {
  name: string
  path: string
}

/** A jump-off point in the picker's side rail (drive, home, common code dir). */
export interface FsRoot {
  label: string
  path: string
  kind: 'drive' | 'home' | 'common'
}

export interface BrowseResult {
  /** The resolved absolute directory being listed. */
  dir: string
  /** Parent directory, or null at a filesystem root. */
  parent: string | null
  crumbs: Crumb[]
  entries: DirEntry[]
  /** True when `dir` itself looks like a git repo — the "open this" affordance. */
  isRepo: boolean
  /** True when the listing was capped (very large directory). */
  truncated: boolean
}

/** Directories never worth showing in a repo picker (noise, never the target). */
const SKIP_ALWAYS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information'])

/** Cap on entries returned for one directory — keeps huge dirs from stalling the UI. */
const MAX_ENTRIES = 1000

/** Candidate code-home directories, probed (cheaply) for the side rail. */
const COMMON_DIRS = ['Projects', 'projects', 'code', 'Code', 'src', 'dev', 'repos', 'git']

/**
 * Expand `~` and resolve to an absolute path. Pure apart from the injected
 * `home`, so the `~` rules are unit-testable on every platform.
 *
 * `~` alone, `~/x` and (on Windows) `~\x` expand; `~user` does not — we cannot
 * resolve another account's home portably, so it is left alone and will simply
 * fail the existence check with a clear message.
 */
export function expandPath(input: string, home: string = homedir()): string {
  const trimmed = input.trim()
  if (trimmed === '') return trimmed
  let out = trimmed
  if (out === '~') out = home
  else if (out.startsWith('~/') || out.startsWith('~\\')) out = join(home, out.slice(2))
  return resolve(out)
}

/** True when `dir` contains a `.git` entry (dir for a checkout, file for a worktree). */
export function looksLikeRepo(dir: string): boolean {
  try {
    return existsSync(join(dir, '.git'))
  } catch {
    // Permission-denied probes are not repos as far as the picker is concerned.
    return false
  }
}

/**
 * Filesystem roots plus useful jump-off points for the picker's side rail.
 *
 * Windows has no single root, so we probe drive letters (`C:\`…`Z:\`); POSIX
 * gets `/`. Home and any existing common code dir (`~/Projects`, `~/code`, …)
 * are appended so the first click is usually the right one.
 */
export function listRoots(home: string = homedir()): FsRoot[] {
  const roots: FsRoot[] = []

  if (process.platform === 'win32') {
    // A: and B: are historical floppy letters — probing them can stall.
    for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
      const drive = `${String.fromCharCode(code)}:${sep}`
      try {
        if (existsSync(drive)) roots.push({ label: drive.replace(/\\$/, ''), path: drive, kind: 'drive' })
      } catch {
        // Disconnected network drive — skip it.
      }
    }
  } else {
    roots.push({ label: '/', path: '/', kind: 'drive' })
  }

  if (existsSync(home)) roots.push({ label: 'Home', path: home, kind: 'home' })

  // `COMMON_DIRS` lists case variants (`Projects`/`projects`, `code`/`Code`)
  // because POSIX treats them as different directories. Windows does not, so
  // there both probes hit the one folder — dedupe on the platform's own notion
  // of path identity or the rail shows it twice.
  const seen = new Set(roots.map(pathKey))
  for (const name of COMMON_DIRS) {
    const candidate = join(home, name)
    const key = pathKey({ path: candidate })
    if (seen.has(key) || !existsSync(candidate)) continue
    seen.add(key)
    roots.push({ label: name, path: candidate, kind: 'common' })
  }
  return roots
}

/** Path identity key: case-insensitive on Windows, exact on POSIX. */
function pathKey(r: { path: string }): string {
  return process.platform === 'win32' ? r.path.toLowerCase() : r.path
}

/** Cumulative clickable segments for `dir` (walks up to the root). */
export function crumbsFor(dir: string): Crumb[] {
  const out: Crumb[] = []
  let cur = dir
  for (;;) {
    out.unshift({ name: basename(cur) || cur, path: cur })
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

/** Parent of `dir`, or null when `dir` is already a filesystem root. */
export function parentOf(dir: string): string | null {
  const parent = dirname(dir)
  return parent === dir ? null : parent
}

/**
 * List the navigable subdirectories of `dir` (default: the user's home).
 *
 * Only directories are returned — the picker selects a repo, and files would be
 * pure noise. Passing a *file* path lists its containing directory instead, so
 * pasting `/repo/README.md` lands somewhere useful rather than erroring.
 */
export function browseDir(input?: string, showHidden = false, home: string = homedir()): BrowseResult {
  const target = input && input.trim() !== '' ? expandPath(input, home) : home

  if (!isAbsolute(target)) {
    throw new InvalidInputError(`path is not absolute: ${target}`)
  }
  if (!existsSync(target)) {
    throw new InvalidInputError(`path does not exist: ${target}`)
  }

  // A file (or anything unstattable) browses its parent directory.
  let dir = target
  try {
    if (!statSync(target).isDirectory()) dir = dirname(target)
  } catch (e) {
    throw new InvalidInputError(`cannot read path: ${target} (${errMsg(e)})`)
  }

  let dirents: Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch (e) {
    throw new InvalidInputError(`cannot read directory: ${dir} (${errMsg(e)})`)
  }

  const entries: DirEntry[] = []
  let truncated = false
  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
    const name = dirent.name
    if (SKIP_ALWAYS.has(name)) continue
    if (!showHidden && name.startsWith('.')) continue

    const path = join(dir, name)
    const isSymlink = dirent.isSymbolicLink()
    // `withFileTypes` reports symlinks as links, not dirs — stat to see through
    // them, tolerating broken links and permission errors by skipping.
    let isDirectory = dirent.isDirectory()
    if (isSymlink) {
      try {
        isDirectory = statSync(path).isDirectory()
      } catch {
        continue
      }
    }
    if (!isDirectory) continue

    entries.push({ name, path, isRepo: looksLikeRepo(path), isSymlink })
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    dir,
    parent: parentOf(dir),
    crumbs: crumbsFor(dir),
    entries,
    isRepo: looksLikeRepo(dir),
    truncated,
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
