import { spawnSync, type StdioOptions } from 'node:child_process'
import { lstatSync, readdirSync, statfsSync } from 'node:fs'
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

/** Every regular file under `dir`, as forward-slashed relative paths. Symlinks are skipped. */
export function walkFiles(dir: string, base = ''): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...walkFiles(join(dir, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files
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
