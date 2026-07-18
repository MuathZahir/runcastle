import { type ChildProcess, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ASSET_ENV, resolveAsset } from '../launcher/asset-paths'
import { resolveExecutable } from '../util/resolve-executable'
import type { CreatePtyOptions, PtySession } from './pty'

/**
 * Sidecar PTY backend (UI-SPEC §5). Runs `packages/server/src/pty/pty-host.cjs`
 * under SYSTEM `node` and drives it over a newline-JSON stdio protocol (see the
 * host for the frame shapes). This is the backend the server picks under Bun on
 * win32, where node-pty's ConPTY input pipe (a Node `net.Socket`) is unusable and
 * `write()` throws `ERR_SOCKET_CLOSED`, silently dropping every keystroke. Node's
 * `net` keeps that pipe alive, so hosting node-pty in a real `node` process
 * restores INPUT while keeping the exact same `createPtySession` interface.
 */

// Spawned by system `node`, so the host must be a real file (never bundled). A
// published install vendors it beside the bin and names it via RUNCASTLE_PTY_HOST
// (issue #51); a checkout uses the sibling source file.
const HOST_PATH = resolveAsset(
  ASSET_ENV.ptyHost,
  fileURLToPath(new URL('./pty-host.cjs', import.meta.url)),
)

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

/**
 * Locate a system `node` executable. Under a `node` runtime `process.execPath`
 * IS node; under Bun it is the Bun binary, so we scan PATH. `RUNCASTLE_NODE_BIN`
 * overrides everything (test/escape hatch).
 */
function resolveNodeExecutable(): string {
  const override = process.env.RUNCASTLE_NODE_BIN
  if (override && existsSync(override)) return override
  // Under a `node` runtime `process.execPath` IS node; only under Bun must we
  // scan PATH for a system node (shared PATHEXT-aware resolver).
  if (!isBun()) return process.execPath
  return resolveExecutable('node', { exts: process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''] })
}

/** Resolve node-pty's entry once so the host never has to re-resolve it. */
function resolveNodePtyEntry(): string | null {
  try {
    return createRequire(import.meta.url).resolve('node-pty')
  } catch {
    return null
  }
}

type DataListener = (data: Buffer) => void
type ExitListener = (event: { exitCode: number; signal?: number }) => void

interface HostMessage {
  t?: string
  d?: string
  pid?: number
  code?: number
  signal?: number | null
  message?: string
}

/**
 * Spawn the node sidecar and return a `PtySession`. Synchronous, like the native
 * backend: the child spawn + its `ready`/`data`/`exit` frames all arrive on later
 * ticks, after the registry has attached its `onData`/`onExit` listeners.
 */
export function createSidecarPtySession(
  cmd: string,
  args: string[],
  opts: CreatePtyOptions,
): PtySession {
  const nodeExe = resolveNodeExecutable()
  const nodePtyEntry = resolveNodePtyEntry()
  const hostArgs = nodePtyEntry ? [HOST_PATH, nodePtyEntry] : [HOST_PATH]

  const child: ChildProcess = spawn(nodeExe, hostArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const dataListeners = new Set<DataListener>()
  const exitListeners = new Set<ExitListener>()
  // Buffer any output that arrives before the first onData listener attaches
  // (registry attaches synchronously after this returns, so this is belt-and-
  // braces against reordering) and flush it on first subscribe.
  let pending: Buffer[] | null = []
  let pid = child.pid ?? -1
  let killed = false
  let exitFired = false

  function emitData(buf: Buffer): void {
    if (dataListeners.size === 0) {
      pending?.push(buf)
      return
    }
    for (const l of dataListeners) l(buf)
  }

  function fireExit(exitCode: number, signal?: number): void {
    if (exitFired) return
    exitFired = true
    killed = true
    for (const l of exitListeners) l({ exitCode, signal })
  }

  // --- stdout: newline-JSON frames from the host ---
  let acc = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    acc += chunk
    let nl: number
    while ((nl = acc.indexOf('\n')) !== -1) {
      const line = acc.slice(0, nl)
      acc = acc.slice(nl + 1)
      if (!line) continue
      let msg: HostMessage
      try {
        msg = JSON.parse(line) as HostMessage
      } catch {
        continue
      }
      switch (msg.t) {
        case 'ready':
          if (typeof msg.pid === 'number') pid = msg.pid
          break
        case 'data':
          if (typeof msg.d === 'string') emitData(Buffer.from(msg.d, 'base64'))
          break
        case 'exit':
          fireExit(typeof msg.code === 'number' ? msg.code : 0, msg.signal ?? undefined)
          break
        case 'error':
          // Fatal host/spawn failure: surface on stderr and end the session so
          // the WS layer broadcasts `ended` instead of hanging.
          process.stderr.write(`[pty-sidecar] host error: ${msg.message ?? 'unknown'}\n`)
          fireExit(1)
          break
      }
    }
  })

  // Host diagnostics → server stderr (never stdout: that's the protocol stream).
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    process.stderr.write(chunk)
  })

  child.on('error', (err) => {
    process.stderr.write(`[pty-sidecar] failed to spawn node host: ${err.message}\n`)
    fireExit(1)
  })
  child.on('exit', (code, signal) => {
    fireExit(code ?? 0, signal ? 1 : undefined)
  })

  function sendToHost(obj: unknown): void {
    if (!child.stdin || child.stdin.destroyed) return
    try {
      child.stdin.write(JSON.stringify(obj) + '\n')
    } catch {
      // stdin gone — the child is dead; exit handling will fire.
    }
  }

  // First frame: spawn request. env values must be strings for JSON transport.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.env)) {
    if (typeof v === 'string') env[k] = v
  }
  sendToHost({
    t: 'spawn',
    file: cmd,
    args,
    opts: {
      cwd: opts.cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      useConpty: opts.useConpty ?? true,
      env,
    },
  })

  return {
    onData(listener) {
      dataListeners.add(listener)
      if (pending && pending.length > 0) {
        const flush = pending
        pending = null
        for (const buf of flush) listener(buf)
      } else {
        pending = null
      }
      return {
        dispose() {
          dataListeners.delete(listener)
        },
      }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return {
        dispose() {
          exitListeners.delete(listener)
        },
      }
    },
    write(data) {
      sendToHost({ t: 'write', d: Buffer.from(data, 'utf8').toString('base64') })
    },
    resize(cols, rows) {
      sendToHost({ t: 'resize', cols: Math.max(1, cols), rows: Math.max(1, rows) })
    },
    kill() {
      if (killed) return
      sendToHost({ t: 'kill' })
      // Backstop: if the host doesn't exit promptly, kill the host process.
      setTimeout(() => {
        if (!exitFired && !child.killed) {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
        }
      }, 500)
    },
    get pid() {
      return pid
    },
    get killed() {
      return killed
    },
  }
}
