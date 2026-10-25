import type { AppCtx } from '../db/types'
import { endSession } from '../pty/end-session'
import { ptyRegistry } from '../pty/registry'
import { getSessionRow } from './sessions'

/**
 * Untouched auto-resumed chats close when you leave
 * (`opening-a-feature-shows-its-chat-as-you-left-it` decision 2).
 *
 * Opening a feature resumes its chat by itself, and each live chat is a running
 * agent process, so clicking through six features must not leave six running.
 * A session an automatic resume spawned is "untouched" until it receives a
 * prompt of any kind — typed by the human or delivered by runcastle — and a
 * chat with no prompt has never started a turn, so ending it cuts off nothing.
 * It is "left" once no browser has its terminal attached for
 * {@link UNTOUCHED_LEAVE_GRACE_MS}: the grace keeps a reload, or a quick click
 * away and back, from churning the process.
 *
 * In memory on purpose: a server restart kills every PTY anyway.
 */

export const UNTOUCHED_LEAVE_GRACE_MS = 10_000

interface UntouchedSession {
  ctx: AppCtx
  timer?: ReturnType<typeof setTimeout>
}

const untouched = new Map<string, UntouchedSession>()
let graceMs = UNTOUCHED_LEAVE_GRACE_MS
let unsubscribe: (() => void) | undefined

/** Test seam: shorten the leave grace. Returns a restore. */
export function setUntouchedLeaveGrace(ms: number): () => void {
  graceMs = ms
  return () => {
    graceMs = UNTOUCHED_LEAVE_GRACE_MS
  }
}

/**
 * A session an automatic resume just spawned: watch it until it is prompted.
 * Spawned with no terminal attached, its leave grace starts now.
 */
export function markAutoResumed(ctx: AppCtx, sessionId: string): void {
  unsubscribe ??= ptyRegistry().onSinksChanged(sinksChanged)
  untouched.set(sessionId, { ctx })
  sinksChanged(sessionId, ptyRegistry().get(sessionId)?.sinks.size ?? 0)
}

/**
 * Stop watching a session: it received a prompt, so it is an ordinary live chat
 * from now on — or it ended some other way.
 */
export function forgetUntouched(sessionId: string): void {
  const entry = untouched.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  untouched.delete(sessionId)
}

function sinksChanged(sessionId: string, attached: number): void {
  const entry = untouched.get(sessionId)
  if (!entry) return
  if (attached > 0) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    return
  }
  if (entry.timer) return
  entry.timer = setTimeout(() => leave(sessionId), graceMs)
  entry.timer.unref?.()
}

/**
 * The grace ran out. Re-checked rather than trusted: a sink may have attached
 * and the row may have ended meanwhile. The callback runs on a bare timer, where
 * a throw would be uncaught, so a failure is logged and swallowed.
 */
function leave(sessionId: string): void {
  const entry = untouched.get(sessionId)
  if (!entry) return
  entry.timer = undefined
  if ((ptyRegistry().get(sessionId)?.sinks.size ?? 0) > 0) return
  untouched.delete(sessionId)
  try {
    const row = getSessionRow(entry.ctx, sessionId)
    if (row && row.status !== 'ended') {
      endSession(entry.ctx, sessionId, 'chat closed — it resumed by itself and was left unused')
    }
  } catch (err) {
    console.error(`[untouched] ending ${sessionId} failed`, err)
  }
}
