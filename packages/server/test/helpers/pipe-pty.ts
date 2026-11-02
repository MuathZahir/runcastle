import { spawn } from 'node:child_process'
import { installPtyStandIn, type PtyFactory, type PtySession } from '../../src/pty/pty'
import { killProcessTree } from '../../src/pty/kill-tree'

/**
 * A terminal stand-in on plain pipes, for suites on vitest's node runtime that
 * only need a process to talk to: output, exit, tree kill. It is not a terminal
 * (no TTY, resize does nothing), so real terminal behaviour stays with the
 * real-Bun fixtures (`fixtures/pty-bun.ts`).
 */

/** How long after exit to keep reading, since a child's last output can trail it. */
const OUTPUT_TAIL_MS = 50

const createPipeSession: PtyFactory = (cmd, args, opts) => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.env)) if (typeof v === 'string') env[k] = v

  // `detached` makes the child a process-group leader on POSIX, as a real PTY
  // session leader is, so `killProcessTree` reaches its whole group.
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env,
    stdio: 'pipe',
    detached: process.platform !== 'win32',
    windowsHide: true,
  })

  const dataListeners = new Set<(data: Buffer) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  const pending: Buffer[] = []
  let exited = false

  const emit = (chunk: Buffer): void => {
    if (dataListeners.size === 0) pending.push(chunk)
    for (const l of dataListeners) l(chunk)
  }
  const finish = (exitCode: number): void => {
    if (exited) return
    exited = true
    for (const l of exitListeners) l({ exitCode })
  }

  child.stdout?.on('data', emit)
  child.stderr?.on('data', emit)
  child.stdin?.on('error', () => {})
  child.on('error', (err) => {
    emit(Buffer.from(err.message))
    finish(1)
  })
  child.on('exit', (code) => {
    setTimeout(() => finish(code ?? 0), OUTPUT_TAIL_MS)
  })

  const session: PtySession = {
    onData(listener) {
      dataListeners.add(listener)
      for (const chunk of pending.splice(0)) listener(chunk)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write(data) {
      child.stdin?.write(data)
    },
    resize() {},
    kill() {
      child.kill()
    },
    killTree: () => killProcessTree(child.pid ?? -1),
    get pid() {
      return child.pid ?? -1
    },
    get killed() {
      return exited
    },
  }
  return session
}

/** Point this test file's terminals at the pipe stand-in. */
export function usePipePty(): void {
  installPtyStandIn(createPipeSession)
}
