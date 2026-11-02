import { spawnSync, type StdioOptions } from 'node:child_process'
import { lstatSync, readdirSync, realpathSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Plain process and file helpers for a move. A move talks to git directly rather
 * than through `services/git.ts`, because everything here runs with no server,
 * no database context and, on the old machine, a promise to change nothing.
 */

const HUGE_OUTPUT = 512 * 1024 * 1024

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; input?: string; stdio?: StdioOptions; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    input: opts.input,
    stdio: opts.stdio,
    env: opts.env,
    encoding: 'utf8',
    maxBuffer: HUGE_OUTPUT,
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error?.message ?? ''),
  }
}

/**
 * Git never writes to the repo it reads here. `git status` normally refreshes
 * the index as a side effect, and this environment variable is git's own switch
 * for not doing that, so scanning leaves the old machine's repos byte-identical.
 */
const READ_ONLY_GIT = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

export function git(cwd: string, args: string[]): RunResult {
  return run('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: READ_ONLY_GIT })
}

/** Run git and return its output, or throw with what it said. */
export function gitOrThrow(cwd: string, args: string[]): string {
  const result = git(cwd, args)
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`)
  return result.stdout
}

/** A NUL-separated git listing as an array. */
export function nulList(output: string): string[] {
  return output.split('\0').filter((entry) => entry.length > 0)
}

/**
 * The system `tar`, by its full path on Windows: Git Bash's GNU tar comes first
 * on many PATHs there, and it reads `C:` in a path as a remote host.
 */
export function systemTar(): string {
  if (process.platform !== 'win32') return 'tar'
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/**
 * Every regular file under `dir`, as forward-slashed relative paths. Symlinks
 * are skipped. With `strict`, a folder that cannot be read throws: a pack must
 * not quietly leave out what it could not see.
 */
export function walkFiles(dir: string, base = '', strict = false): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (strict) throw err
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...walkFiles(join(dir, entry.name), rel, strict))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

/**
 * Every file under `path`, following links, as forward-slashed paths under `rel`.
 * A Claude skill is often a link to a folder elsewhere, and only what it points at
 * means anything on another machine. `node_modules` and `.git` stay out: one is
 * built for this system and the other is not part of a skill. A link that leads
 * nowhere, or back into itself, goes in `broken`.
 */
export function walkFollowing(path: string, rel: string, broken: string[], parents: string[] = []): string[] {
  let real: string
  let isDirectory: boolean
  try {
    real = realpathSync(path)
    isDirectory = statSync(path).isDirectory()
  } catch {
    broken.push(rel)
    return []
  }
  if (!isDirectory) return [rel]
  if (parents.includes(real)) {
    broken.push(rel)
    return []
  }
  return readdirSync(path)
    .filter((name) => name !== 'node_modules' && name !== '.git')
    .flatMap((name) => walkFollowing(join(path, name), `${rel}/${name}`, broken, [...parents, real]))
}

/** Every symlink under `dir`, as forward-slashed relative paths. {@link walkFiles} skips these. */
export function walkSymlinks(dir: string, base = ''): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const links: string[] = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) links.push(rel)
    else if (entry.isDirectory()) links.push(...walkSymlinks(join(dir, entry.name), rel))
  }
  return links
}

/** Whether `path` is itself a symlink or a Windows junction. */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * The link a relative path sits behind, itself included, or `null`. Git for
 * Windows follows a junction and lists the files behind it as ordinary files,
 * so looking at the file alone never shows the link.
 */
export function linkInPath(root: string, rel: string): string | null {
  const segments = rel.split('/')
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join('/')
    if (isSymlink(join(root, prefix))) return prefix
  }
  return null
}

/** Total size of a file or folder, 0 when it cannot be read. */
export function pathBytes(path: string): number {
  try {
    const stat = lstatSync(path)
    if (!stat.isDirectory()) return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
  return walkFiles(path).reduce((total, rel) => total + pathBytes(join(path, rel)), 0)
}

/** Free bytes on the disk holding `path`, or `null` when the system will not say. */
export function freeBytes(path: string): number | null {
  try {
    const stats = statfsSync(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** A compact local timestamp for folder names: `20261031-142530`. */
export function stamp(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}
