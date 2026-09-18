import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { reviewWalkthroughPath } from '@runcastle/core/paths'
import { AGENT_BROWSER_BIN, findOnPath } from './review-ticket'

export interface RecorderReapOutcome {
  readonly confirmed: boolean
}

export interface RecorderReapDeps {
  /** Resolve the agent-browser executable, or undefined when it is unavailable. */
  readonly findBrowser: () => string | undefined
  /** Whether this review ever created a walkthrough recording. */
  readonly fileExists: (path: string) => boolean
  /** Run one agent-browser command. Resolves on exit, close, error, or its backstop. */
  readonly runCommand: (bin: string, args: readonly string[]) => Promise<boolean>
  /** True once the walkthrough can be opened for writing. */
  readonly handleReleased: (path: string) => boolean
}

export interface RecorderReapOptions {
  /** Whole stop/close/confirmation budget. Default 10s. */
  readonly timeoutMs?: number
  /** Gap between file-handle probes. Default 100ms. */
  readonly pollIntervalMs?: number
  /** System boundaries exposed for deterministic unit tests. */
  readonly deps?: Partial<RecorderReapDeps>
}

const DEFAULT_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 100
const COMMAND_TIMEOUT_MS = 5_000

function log(message: string): void {
  console.error(`[recorder-reap] ${message}`)
}

/** Spawn without a shell and settle under Bun/Windows even when a child misbehaves. */
function runCommand(bin: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => settle(false), COMMAND_TIMEOUT_MS)
    timer.unref?.()

    try {
      const child = spawn(bin, [...args], { windowsHide: true, stdio: 'ignore' })
      child.on('exit', (code) => settle(code === 0))
      child.on('close', (code) => settle(code === 0))
      child.on('error', () => settle(false))
    } catch {
      settle(false)
    }
  })
}

function handleReleased(path: string): boolean {
  try {
    const fd = openSync(path, 'r+')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withDeadline(body: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    void body
      .catch(() => false)
      .then((confirmed) => {
        clearTimeout(timer)
        resolve(confirmed)
      })
  })
}

const REAL_DEPS: RecorderReapDeps = {
  findBrowser: () => findOnPath(AGENT_BROWSER_BIN),
  fileExists: existsSync,
  runCommand,
  handleReleased,
}

/**
 * Stop and close the deterministic browser session for one review lane, then
 * wait until its walkthrough is no longer held open. Never rejects.
 */
export async function reapRecorder(
  ticketId: string,
  options: RecorderReapOptions = {},
): Promise<RecorderReapOutcome> {
  const deps = { ...REAL_DEPS, ...options.deps }
  const walkthroughPath = reviewWalkthroughPath(ticketId)
  try {
    const browser = deps.findBrowser()
    if (!browser || !deps.fileExists(walkthroughPath)) return { confirmed: true }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
    const session = `review-${ticketId}`
    const started = Date.now()
    const confirm = async (): Promise<boolean> => {
      await deps.runCommand(browser, ['--session', session, 'record', 'stop'])
      await deps.runCommand(browser, ['--session', session, 'close'])
      do {
        if (deps.handleReleased(walkthroughPath)) return true
        await delay(pollIntervalMs)
      } while (Date.now() - started < timeoutMs)
      return false
    }

    const confirmed = await withDeadline(confirm(), timeoutMs)
    if (!confirmed) {
      log(`session=${session} NOT confirmed stopped (${timeoutMs}ms deadline); recorder may still be running`)
    }
    return { confirmed }
  } catch (error) {
    log(`ticket=${ticketId} reap failed; recorder may still be running: ${error instanceof Error ? error.message : String(error)}`)
    return { confirmed: false }
  }
}
