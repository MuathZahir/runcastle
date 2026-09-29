import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ptyRegistry } from '../../src/pty/registry'
import { resolveTool } from '../../src/util/resolve-executable'

/**
 * Shared by the Job Object Bun fixtures (`job-object-session-end.ts`,
 * `job-object-crash.ts`): open a REAL registry terminal running the claude stub
 * and read back the pids it prints. Under Bun on win32 `selectBackend()` picks
 * the sidecar, so the terminal's host is contained exactly as in production.
 */

const STUB = fileURLToPath(new URL('./claude-stub.cjs', import.meta.url))

/** How long the stub may take to print its pids through ConPTY. */
const PIDS_TIMEOUT_MS = 20_000

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** True while `pid` is still a live process. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Poll until every pid is gone, or the deadline passes. Returns the survivors. */
export async function awaitDead(pids: number[], timeoutMs: number): Promise<number[]> {
  const started = Date.now()
  while (pids.some(pidAlive) && Date.now() - started < timeoutMs) await delay(100)
  return pids.filter(pidAlive)
}

export interface StubTerminal {
  /** The sidecar host the server spawned (and contained). */
  hostPid: number
  /** The stub that starts the MCP stand-in and then exits. */
  stubPid: number
  /** The long-lived MCP stand-in the stub orphans. */
  mcpPid: number
  /** "nest" mode only: the stub's parent, which keeps the terminal alive. */
  nestPid: number | null
  /** Resolves when the terminal's PTY exits. */
  exited: Promise<void>
}

/** Open the stub in a registry terminal and wait until it has reported its pids. */
export async function openStubTerminal(sessionId: string, mode: 'exit' | 'nest'): Promise<StubTerminal> {
  let resolveExit = (): void => {}
  const exited = new Promise<void>((r) => {
    resolveExit = r
  })
  const node = resolveTool('node', { exts: process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''] })
  const entry = ptyRegistry().create({
    sessionId,
    cmd: node,
    args: [STUB, mode],
    opts: { cwd: tmpdir(), env: process.env, cols: 200, rows: 24 },
    onExit: () => resolveExit(),
  })
  // Read on THIS tick: the sidecar swaps in the inner node-pty pid on `ready`.
  const hostPid = entry.pty.pid

  const started = Date.now()
  let output = ''
  for (;;) {
    // Strip CSI sequences: node colours the numbers on a TTY, and ConPTY adds its own.
    output = entry.buffer
      .snapshot()
      .toString('utf8')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    const stub = output.match(/claude-stub pid (\d+) mcp pid (\d+)/)
    const nest = output.match(/nest pid (\d+)/)
    if (stub && (mode === 'exit' || nest)) {
      return {
        hostPid,
        stubPid: Number(stub[1]),
        mcpPid: Number(stub[2]),
        nestPid: nest ? Number(nest[1]) : null,
        exited,
      }
    }
    if (Date.now() - started > PIDS_TIMEOUT_MS) {
      throw new Error(`stub never printed its pids. Terminal output:\n${output}`)
    }
    await delay(100)
  }
}
