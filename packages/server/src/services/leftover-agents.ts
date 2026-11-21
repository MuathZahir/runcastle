import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createSystemExec } from '../doctor/system-exec'
import type { ExecFn } from '../doctor/doctor'
import { readProcStat, stopProcessTree } from '../pty/kill-tree'

/**
 * The start-up clean (stopping-a-session-kills-its-process decisions 5 and 6):
 * agent processes an earlier run of this server started and never stopped (the
 * 1.7.4 leak left 66 `claude` and 67 `bun` behind) are ended once, at boot.
 *
 * A process counts as a leftover only when it carries this runcastle's own mark.
 * Every agent runcastle starts runs with `RUNCASTLE_SESSION_ID` and
 * `RUNCASTLE_SERVER_URL` in its environment, and everything it starts inherits
 * them; the URL names this server (its port), so another install, or a drive of
 * runcastle on another port, is never touched. Only one server can hold the port,
 * so once this one listens, any process still marked with its URL belongs to a
 * dead earlier run. Where another process's environment cannot be read
 * (Windows), `claude` is matched on its `--settings` path under this data
 * folder's `sessions/`, and the adapter as the parent of such a `claude`.
 *
 * The server itself, everything descended from it, and every process it runs
 * under (a server restarted from a runcastle terminal carries the mark too) are
 * always skipped, and its own process group is never signalled.
 */

/** One process, as the start-up clean reads it. */
export interface ProcInfo {
  pid: number
  ppid: number
  /** The process group id; undefined where it cannot be read (Windows). */
  pgid?: number
  /** Its command line, arguments joined by spaces. */
  command: string
  /**
   * Its environment, where readable. `raw` is used when the environment comes
   * as one text with the command (macOS `ps -E`), and is matched by substring.
   */
  env?: Record<string, string> | { raw: string }
}

/** What identifies this server's agents. */
export interface LeftoverMark {
  /** This server's own URL, as its agents carry it in `RUNCASTLE_SERVER_URL`. */
  serverUrl: string
  /** This install's data folder; its `sessions/` holds each agent's settings (Windows match). */
  dataDir: string
  /** The server's own pid: it and its descendants are never leftovers. */
  selfPid: number
}

/** Whether a process's environment carries this server's mark; undefined when it is unreadable. */
function envMarked(env: ProcInfo['env'], serverUrl: string): boolean | undefined {
  if (!env) return undefined
  if ('raw' in env && typeof env.raw === 'string') {
    const raw = ` ${env.raw} `
    // No session id at all: either not an agent, or an environment `ps` would not show; the settings path decides.
    if (!raw.includes(' RUNCASTLE_SESSION_ID=')) return undefined
    return raw.includes(` RUNCASTLE_SERVER_URL=${serverUrl} `)
  }
  const vars = env as Record<string, string>
  return !!vars.RUNCASTLE_SESSION_ID && vars.RUNCASTLE_SERVER_URL === serverUrl
}

/** Case-insensitive on Windows paths, either slash. */
function normPath(text: string): string {
  return text.replace(/\\/g, '/').toLowerCase()
}

/**
 * The leftovers among `procs`: marked as this server's, and neither the server
 * nor a descendant of it. Pure, so each platform's reading is tested on its own.
 */
export function pickLeftovers(procs: ProcInfo[], mark: LeftoverMark): ProcInfo[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  // The server's own ancestors: whatever it was started from, a runcastle terminal included.
  const above = new Set<number>()
  for (let at = byPid.get(byPid.get(mark.selfPid)?.ppid ?? -1); at && !above.has(at.pid); at = byPid.get(at.ppid)) above.add(at.pid)
  const ours = (p: ProcInfo): boolean => {
    if (above.has(p.pid)) return true
    // Walk up the parents; a cycle or a missing parent ends the walk.
    const seen = new Set<number>()
    for (let at: ProcInfo | undefined = p; at && !seen.has(at.pid); at = byPid.get(at.ppid)) {
      if (at.pid === mark.selfPid) return true
      seen.add(at.pid)
    }
    return false
  }
  const sessionsDir = normPath(join(mark.dataDir, 'sessions') + sep)
  const settingsMarked = (p: ProcInfo): boolean => {
    const cmd = normPath(p.command)
    return cmd.includes('--settings') && cmd.includes(sessionsDir)
  }
  const marked = new Set<number>()
  for (const p of procs) {
    const byEnv = envMarked(p.env, mark.serverUrl)
    if (byEnv === true) marked.add(p.pid)
    else if (byEnv === undefined && settingsMarked(p)) {
      marked.add(p.pid)
      // The adapter that started this `claude`, when it is runcastle's adapter.
      const parent = byPid.get(p.ppid)
      if (parent && /claude-agent-acp|codex-acp/.test(parent.command)) marked.add(parent.pid)
    }
  }
  return procs.filter((p) => marked.has(p.pid) && !ours(p))
}

/** Linux: everything from `/proc`. */
function listLinux(): ProcInfo[] {
  const out: ProcInfo[] = []
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const stat = readProcStat(name)
    if (!stat || stat.state === 'Z' || stat.state === 'X') continue
    try {
      // Another user's environment is not ours to read; it stays in the list so the parent walk is whole.
      let env: Record<string, string> | undefined
      try {
        env = {}
        for (const entry of readFileSync(`/proc/${name}/environ`, 'utf8').split('\0')) {
          const eq = entry.indexOf('=')
          if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
        }
      } catch {
        env = undefined
      }
      out.push({
        pid: Number(name),
        ppid: stat.ppid,
        pgid: stat.pgid,
        command: readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').join(' ').trim(),
        ...(env ? { env } : {}),
      })
    } catch {
      // Gone since the listing, or another user's: neither is ours.
    }
  }
  return out
}

/**
 * macOS: `ps -E` appends each same-user process's environment to its command.
 * Lines are `pid ppid pgid command [env…]`.
 */
export function parsePsWithEnv(text: string): ProcInfo[] {
  const out: ProcInfo[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const rest = m[4] ?? ''
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: rest, env: { raw: rest } })
  }
  return out
}

/** Windows: `Get-CimInstance Win32_Process`, as JSON. No environment is readable. */
export function parseCimProcesses(text: string): ProcInfo[] {
  let rows: unknown
  try {
    rows = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(rows) ? rows : rows ? [rows] : []
  const out: ProcInfo[] = []
  for (const row of list as { ProcessId?: number; ParentProcessId?: number; CommandLine?: string | null }[]) {
    if (typeof row.ProcessId !== 'number') continue
    out.push({ pid: row.ProcessId, ppid: row.ParentProcessId ?? 0, command: row.CommandLine ?? '' })
  }
  return out
}

/** Every process this user can see, the way its platform allows. */
export async function listProcesses(exec: ExecFn = createSystemExec({ timeoutMs: 15_000, noStdin: true })): Promise<ProcInfo[]> {
  if (process.platform === 'linux') return listLinux()
  if (process.platform === 'win32') {
    const r = await exec('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
    ])
    return r.ok && r.code === 0 ? parseCimProcesses(r.stdout) : []
  }
  const r = await exec('ps', ['-E', '-ww', '-A', '-o', 'pid=,ppid=,pgid=,command='])
  return r.ok && r.code === 0 ? parsePsWithEnv(r.stdout) : []
}

/** How long the start-up clean lets each leftover quit before forcing it. */
const LEFTOVER_GRACE_MS = 2000

/** What the start-up clean did: leftovers found, and how many of them are confirmed gone. */
export interface SweepResult {
  found: number
  ended: number
}

/**
 * End this server's leftovers from earlier runs. Never rejects: a listing that
 * fails is logged and the boot goes on; a survivor is named by the stop's own log line.
 */
export async function sweepLeftoverAgents(
  mark: LeftoverMark,
  deps: { list?: () => Promise<ProcInfo[]>; stop?: typeof stopProcessTree } = {},
): Promise<SweepResult> {
  let procs: ProcInfo[]
  try {
    procs = await (deps.list ?? (() => listProcesses()))()
  } catch (err) {
    console.error('leftover agents: could not list processes', err)
    return { found: 0, ended: 0 }
  }
  const leftovers = pickLeftovers(procs, mark)
  const stop = deps.stop ?? stopProcessTree
  // A group the server itself is in is never signalled whole.
  const selfGroup = procs.find((p) => p.pid === mark.selfPid)?.pgid
  const results = await Promise.all(
    leftovers.map((p) =>
      stop(p.pid, { group: p.pgid === p.pid && p.pgid !== selfGroup, graceMs: LEFTOVER_GRACE_MS, label: 'leftover agent process' }).catch(() => ({ gone: false, forced: false })),
    ),
  )
  return { found: leftovers.length, ended: results.filter((r) => r.gone).length }
}
