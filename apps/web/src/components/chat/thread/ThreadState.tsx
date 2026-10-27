import type { ThreadState } from '../../../lib/chat-thread'
import { Spinner, StatusDot } from '../../../ui'

/** "now", "4m", "3h", "2d". */
function ago(at: number, now = Date.now()): string {
  const m = Math.round((now - at) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

/**
 * A thread's state as its mark (decision 14), the same in the header's thread
 * list and the project page's chat list: a spinner while it works, a dot while
 * it waits on you, nothing idle.
 */
export function ThreadStateMark({ state }: { state: ThreadState }) {
  if (state === 'working') return <Spinner size="sm" />
  if (state === 'waiting') return <StatusDot tone="warning" label="Waiting for you" />
  return null
}

/** A thread's state in words: working, waiting for you, or how long it has been idle. */
export function threadStateWords(state: ThreadState, updatedAt: number, now?: number): string {
  return state === 'waiting' ? 'waiting for you' : state === 'working' ? 'working' : ago(updatedAt, now)
}
