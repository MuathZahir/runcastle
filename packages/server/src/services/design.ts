import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { SessionRow } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { devPaneLive, spawnDevPane, stopDevPane } from '../pty/dev-pane'
import { exitTail } from '../pty/exit-tail'
import { ptyRegistry } from '../pty/registry'
import { emit } from './events'
import { getFeatureRow, projectForFeature } from './repo'

/**
 * The design server (design-mode decisions 3 and 10): the project's own frontend
 * dev server, serving the chat's preview pages from the feature's talk worktree.
 *
 * Runcastle never understands the framework. The agent supplies the command and
 * puts `$RUNCASTLE_DESIGN_PORT` in it; runcastle picks that port, runs the
 * command in a pane it owns, sniffs the URL the server prints and hands it back.
 * The command is recorded in the worktree's `.runcastle/design.json` so later
 * starts — the web's Open in design, another feature — need none.
 *
 * One server per feature, no per-project slot: a frontend-only dev server is
 * cheap, unlike the whole app ADR-0014 rations. It stops when the feature's chat
 * session ends, when the feature ships, or after {@link IDLE_MS} without a
 * heartbeat from a visible design view.
 */

/** Why a design server stopped — carried on `design.server_stopped`. */
export type DesignStopReason = 'session-ended' | 'idle' | 'shipped' | 'stopped' | 'failed'

/** A running design server, as start returns it. */
export interface DesignServerInfo {
  url: string
  port: number
  command: string
}

/** What the web asks about a feature's design server. */
export interface DesignServerStatus {
  running: boolean
  url?: string
  port?: number
  hasRecordedCommand: boolean
  /** The last path the design view was opened at, so a bare reopen lands there rather than on `/`. */
  lastPath?: string
}

/** The env var the agent's command reads its port from. */
export const DESIGN_PORT_ENV = 'RUNCASTLE_DESIGN_PORT'

/** The recorded command's file, relative to the worktree. */
const DESIGN_JSON = join('.runcastle', 'design.json')

/** A server silent this long — no heartbeat from a visible design view — is stopped. */
export const IDLE_MS = 30 * 60_000
/** How often the idle sweep looks. */
const SWEEP_MS = 60_000
/** How long a start waits for the server to print its URL. */
const DEFAULT_URL_TIMEOUT_MS = 60_000

/** Design ports sit above the drives' 20000-29999 window, so the two never contend. */
const PORT_BASE = 30000
const PORT_SPAN = 10000
const PORT_PROBES = 200

/** Registry-id prefix for design panes: never a session id, never a drive's. */
const DESIGN_PREFIX = 'design:'

/** The registry id for a feature's design pane — distinct from its drive's `drive:<id>`. */
export function designPaneId(featureId: string): string {
  return `${DESIGN_PREFIX}${featureId}`
}

interface DesignServer {
  ctx: AppCtx
  paneId: string
  port: number
  command: string
  url?: string
  lastHeartbeat: number
  /** Settles once: the URL arrives, the timeout lapses, the process dies, or it is stopped. */
  ready: Promise<DesignServerInfo>
  /** Fail a start still waiting on its URL; a no-op once it has settled. */
  abort: (reason: string) => void
}

const servers = new Map<string, DesignServer>()
/** Per feature, the design view's last path. Apart from `servers`: it outlives a stop and a restart. */
const lastPaths = new Map<string, string>()
let sweepTimer: ReturnType<typeof setInterval> | undefined

let now: () => number = Date.now
let urlTimeoutMs = DEFAULT_URL_TIMEOUT_MS

/** Test seam: inject the clock and the URL timeout. Omitted fields reset to the defaults. */
export function configureDesignServers(opts: { now?: () => number; urlTimeoutMs?: number }): void {
  now = opts.now ?? Date.now
  urlTimeoutMs = opts.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS
}

/** The feature's talk worktree, or a refusal when it has none yet. */
function talkWorktreeFor(ctx: AppCtx, featureId: string): string {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  const dir = worktreeDir(project.id, feature.slug)
  if (!existsSync(dir)) {
    throw new GateError(`feature ${feature.slug} has no talk worktree yet — open its chat first`)
  }
  return dir
}

/** The command recorded in the worktree's `.runcastle/design.json`, if any. */
function recordedCommand(worktree: string): string | undefined {
  const file = join(worktree, DESIGN_JSON)
  if (!existsSync(file)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const command = (parsed as { command?: unknown } | null)?.command
    return typeof command === 'string' && command.trim() !== '' ? command : undefined
  } catch {
    return undefined
  }
}

/** Record the command for later starts. Never committed here: the agent commits it with its design. */
function recordCommand(worktree: string, command: string): void {
  const file = join(worktree, DESIGN_JSON)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ command }, null, 2)}\n`)
}

/** Free-port probe. Bind rather than scan: nothing else answers truthfully. */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const server = createServer()
    server.once('error', () => resolveP(false))
    server.once('listening', () => server.close(() => resolveP(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * A port derived from the feature, so its design URL stays put across restarts,
 * probed upward past anything already bound — including a sibling design server
 * still booting, which has its port but has not bound it yet.
 */
async function pickPort(featureId: string): Promise<number> {
  const digest = createHash('sha1').update(featureId).digest()
  const base = PORT_BASE + (digest.readUInt32BE(0) % PORT_SPAN)
  const taken = new Set([...servers.values()].map((s) => s.port))
  for (let port = base; port < base + PORT_PROBES; port++) {
    if (!taken.has(port) && (await isFree(port))) return port
  }
  throw new GateError(`no free design port in ${base}..${base + PORT_PROBES}`)
}

/** The pane's output so far, as the readable tail a refusal carries. */
function paneTail(paneId: string): string {
  const entry = ptyRegistry().get(paneId)
  return entry ? exitTail(entry.buffer.snapshot()) : ''
}

/**
 * Start the feature's design server, or return the one already running.
 *
 * `command` is recorded in `.runcastle/design.json`; without it the recorded one
 * runs, and with neither this refuses. A start while a server runs with the same
 * command returns that server; a different command restarts it. Resolves once
 * the URL is sniffed; a server that prints none within the timeout is stopped
 * (`design.server_stopped {reason: 'failed'}`) and the call rejects with its
 * output tail. A start counts as a heartbeat.
 */
export async function startDesignServer(
  ctx: AppCtx,
  featureId: string,
  command?: string,
): Promise<DesignServerInfo> {
  const worktree = talkWorktreeFor(ctx, featureId)
  const given = command?.trim() || undefined
  const resolved = given ?? recordedCommand(worktree)
  if (!resolved) {
    throw new GateError(
      `no design command: pass one (e.g. "bunx vite --port $${DESIGN_PORT_ENV} --strictPort"), ` +
        `it is then recorded in ${DESIGN_JSON.replaceAll('\\', '/')} for later starts`,
    )
  }
  if (given) recordCommand(worktree, given)

  const existing = servers.get(featureId)
  if (existing) {
    if (existing.command === resolved && devPaneLive(existing.paneId)) {
      existing.lastHeartbeat = now()
      return existing.ready
    }
    await stopDesignServer(ctx, featureId, 'stopped')
  }
  return spawnDesignServer(ctx, featureId, worktree, resolved)
}

/**
 * The command with `$RUNCASTLE_DESIGN_PORT`, `${RUNCASTLE_DESIGN_PORT}` and
 * `%RUNCASTLE_DESIGN_PORT%` replaced by the port: `cmd.exe` expands none of the
 * first two, so substituting here makes one recorded command work on every OS.
 */
export function substituteDesignPort(command: string, port: number): string {
  return command.replace(
    new RegExp(`\\$\\{${DESIGN_PORT_ENV}\\}|\\$${DESIGN_PORT_ENV}\\b|%${DESIGN_PORT_ENV}%`, 'g'),
    String(port),
  )
}

/** The sniffed URL, given the server's own port if it printed none. */
export function withPort(url: string, port: number): string {
  try {
    const parsed = new URL(url)
    if (parsed.port) return url
    parsed.port = String(port)
    return parsed.toString()
  } catch {
    return url
  }
}

async function spawnDesignServer(
  ctx: AppCtx,
  featureId: string,
  worktree: string,
  command: string,
): Promise<DesignServerInfo> {
  const port = await pickPort(featureId)
  const paneId = designPaneId(featureId)

  let settle!: { resolve: (info: DesignServerInfo) => void; reject: (err: Error) => void }
  let settled = false
  const ready = new Promise<DesignServerInfo>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const server: DesignServer = {
    ctx,
    paneId,
    port,
    command,
    lastHeartbeat: now(),
    ready,
    abort: (reason) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle.reject(new GateError(reason))
    },
  }
  servers.set(featureId, server)

  // Both failure paths abort with the output tail BEFORE stopping, so the stop's
  // own generic abort finds the start already settled.
  const timer = setTimeout(() => {
    const tail = paneTail(paneId)
    server.abort(
      `the design server printed no localhost URL within ${Math.round(urlTimeoutMs / 1000)}s` +
        (tail ? `. Its output ended:\n${tail}` : ' and printed nothing'),
    )
    void stopDesignServer(ctx, featureId, 'failed')
  }, urlTimeoutMs)

  try {
    spawnDevPane({
      paneId,
      cwd: worktree,
      command: substituteDesignPort(command, port),
      env: { ...process.env, [DESIGN_PORT_ENV]: String(port) },
      onUrl: (sniffed) => {
        if (settled || servers.get(featureId) !== server) return
        settled = true
        clearTimeout(timer)
        const url = withPort(sniffed, port)
        server.url = url
        emit(ctx, featureId, {
          type: 'design.server_started',
          message: `design server at ${url}`,
          data: { url, port, command },
        })
        settle.resolve({ url, port, command })
      },
      onExit: () => {
        // A server that dies on its own is a failure; one we stopped is already gone from the map.
        if (servers.get(featureId) !== server) return
        const tail = paneTail(paneId)
        server.abort(`the design server exited` + (tail ? `. Its output ended:\n${tail}` : ''))
        void stopDesignServer(ctx, featureId, 'failed')
      },
    })
  } catch (err) {
    servers.delete(featureId)
    clearTimeout(timer)
    throw new GateError(`design server failed to start: ${err instanceof Error ? err.message : String(err)}`)
  }
  ensureSweep()
  return ready
}

/**
 * Stop the feature's design server, saying why on the timeline. Idempotent:
 * false (and no event) when none runs. A start still waiting on its URL rejects.
 */
export async function stopDesignServer(
  ctx: AppCtx,
  featureId: string,
  reason: DesignStopReason,
): Promise<boolean> {
  const server = servers.get(featureId)
  if (!server) return false
  servers.delete(featureId)
  if (servers.size === 0) stopSweep()
  server.abort(`the design server was stopped (${reason}) before it printed a URL`)
  await stopDevPane(server.paneId)
  emit(ctx, featureId, {
    type: 'design.server_stopped',
    message: `design server stopped: ${reason}`,
    data: { reason },
  })
  return true
}

/**
 * Stamp that a design view is on screen. Not a timeline event: it lands every
 * few seconds while the pane is visible, and it changes nothing the UI shows.
 * Returns whether a server was there to stamp.
 */
export function heartbeatDesignServer(featureId: string): boolean {
  const server = servers.get(featureId)
  if (!server) return false
  server.lastHeartbeat = now()
  return true
}

/**
 * Remember the path the design view was just opened at — by the agent's
 * `show_panel` or the human's Open in design — so reopening it from the topbar,
 * after another view, feature or a reload, lands there. Like the heartbeat, not
 * a timeline event: the view that opened it already shows it.
 */
export function rememberDesignPath(featureId: string, path: string): void {
  lastPaths.set(featureId, path)
}

/** Whether the feature's design server is up, where, whether a command is recorded, and its last path. */
export function designServerStatus(ctx: AppCtx, featureId: string): DesignServerStatus {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  const worktree = worktreeDir(project.id, feature.slug)
  const hasRecordedCommand = recordedCommand(worktree) !== undefined
  const lastPath = lastPaths.get(featureId)
  const remembered = lastPath !== undefined ? { lastPath } : {}
  const server = servers.get(featureId)
  if (!server?.url || !devPaneLive(server.paneId)) return { running: false, hasRecordedCommand, ...remembered }
  return { running: true, url: server.url, port: server.port, hasRecordedCommand, ...remembered }
}

/**
 * The stop rule for a chat session ending: the human's feature chat owns the
 * design server. A headless run (self-planning, a lead wake) never opened one,
 * so its end leaves the human's alone.
 */
export function stopDesignServerForSession(ctx: AppCtx, session: SessionRow): void {
  if (session.kind !== 'chat' || session.headless || !session.featureId) return
  void stopDesignServer(ctx, session.featureId, 'session-ended').catch(() => {})
}

/** Stop every design server silent for {@link IDLE_MS}. The interval's body; exported for tests. */
export async function sweepIdleDesignServers(): Promise<void> {
  const cutoff = now() - IDLE_MS
  const idle = [...servers.entries()].filter(([, s]) => s.lastHeartbeat <= cutoff)
  for (const [featureId, server] of idle) {
    await stopDesignServer(server.ctx, featureId, 'idle').catch(() => {})
  }
}

function ensureSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => void sweepIdleDesignServers(), SWEEP_MS)
  sweepTimer.unref?.()
}

function stopSweep(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = undefined
}
