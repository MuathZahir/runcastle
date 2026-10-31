import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { spawnTargetFor } from '../util/resolve-executable'
import { AGENT_BROWSER_BIN, findOnPath, runCommand } from './recorder-reap'

/**
 * Screenshots of a review agent's own browser, taken from outside it. The pass's
 * session name is fixed (`review-<ticketId>`), so a second process reaches the
 * browser the agent is walking, its recording and login included.
 */

const LIST_TIMEOUT_MS = 5_000
const SHOT_TIMEOUT_MS = 15_000

export interface ReviewCaptureDeps {
  readonly findBrowser: () => string | undefined
  /** `agent-browser session list`'s output, or null when it would not answer. */
  readonly listSessions: (bin: string) => Promise<string | null>
  /** Run one agent-browser command to its end. */
  readonly run: (bin: string, args: readonly string[]) => Promise<boolean>
  readonly fileExists: (path: string) => boolean
}

/** Listing starts no daemon, so unlike every other command a pipe on it closes. */
function listSessions(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    const target = spawnTargetFor(bin, ['session', 'list'])
    const child = spawn(target.file, target.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, LIST_TIMEOUT_MS)
    timer.unref?.()
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

const REAL_DEPS: ReviewCaptureDeps = {
  findBrowser: () => findOnPath(AGENT_BROWSER_BIN),
  listSessions,
  run: (bin, args) => runCommand(bin, args, SHOT_TIMEOUT_MS),
  fileExists: existsSync,
}

/** Whether `session list`'s output names this session. Lines read `  name`, the current one `→ name`. */
export function sessionListed(listing: string, session: string): boolean {
  return listing.split('\n').some((line) => line.replace(/^[\s→*]+/u, '').trim() === session)
}

export type ReviewCaptureResult = { ok: true } | { ok: false; reason: string }

/**
 * Save a picture of the pass's browser at `path`. It never starts a browser: a
 * capture before the agent opened one would leave a browser nobody closes.
 */
export async function captureReviewShot(
  ticketId: string,
  path: string,
  deps: Partial<ReviewCaptureDeps> = {},
): Promise<ReviewCaptureResult> {
  const { findBrowser, listSessions: list, run, fileExists } = { ...REAL_DEPS, ...deps }
  const browser = findBrowser()
  if (!browser) return { ok: false, reason: `${AGENT_BROWSER_BIN} is not on this machine's PATH.` }
  const session = `review-${ticketId}`
  const listing = await list(browser)
  if (listing !== null && !sessionListed(listing, session)) {
    return { ok: false, reason: 'Your browser is not open yet: open the app with agent-browser first.' }
  }
  const taken = await run(browser, ['--session', session, 'screenshot', path])
  if (!taken || !fileExists(path)) return { ok: false, reason: 'The screenshot failed. Carry on with the review.' }
  return { ok: true }
}
