/**
 * The orchestrator's pending `[runcastle]` lines and the Claude Code waiter that
 * collects them (`whole-cuts-plan-themselves` decision 20).
 *
 * The notifier appends a line per event here, keyed by the live orchestrate
 * session, and kicks that session's delivery. Whatever delivery takes the lines
 * takes ALL of them, so events that end together go as one message with one
 * line each.
 *
 * On Claude Code the taker is a waiter: the session's `asyncRewake` hook
 * long-polls `GET /api/hooks/orchestrator-messages`, which registers here. Only
 * the newest waiter per session is ever answered with lines: a new one answers
 * the one before it `superseded`, so two waiters never hand Claude the same
 * line. A session that ends answers its waiter `ended` and drops its lines.
 *
 * In memory on purpose: a server restart ends every terminal, and the catch-up
 * briefing covers what a relaunched orchestrator missed.
 */

/** What a waiter is answered with. `empty` is a hold that ran out: poll again. */
export type WaiterAnswer =
  | { status: 'lines'; lines: string[] }
  | { status: 'superseded' }
  | { status: 'ended' }
  | { status: 'empty' }

interface Waiter {
  id: string
  answer: (answer: WaiterAnswer) => void
}

const pending = new Map<string, string[]>()
const waiters = new Map<string, Waiter>()

/** Add one line to a session's pending message. */
export function queueOrchestratorLine(sessionId: string, line: string): void {
  const lines = pending.get(sessionId)
  if (lines) lines.push(line)
  else pending.set(sessionId, [line])
}

/** Take every pending line for a session, oldest first; nothing is left behind. */
export function takeOrchestratorLines(sessionId: string): string[] {
  const lines = pending.get(sessionId) ?? []
  pending.delete(sessionId)
  return lines
}

/** Whether a session has any line pending. */
export function hasOrchestratorLines(sessionId: string): boolean {
  return Boolean(pending.get(sessionId)?.length)
}

/** Hand a session's pending lines to its waiter, if it has one and there are any. */
export function answerOrchestratorWaiter(sessionId: string): void {
  const waiter = waiters.get(sessionId)
  if (!waiter || !hasOrchestratorLines(sessionId)) return
  waiters.delete(sessionId)
  waiter.answer({ status: 'lines', lines: takeOrchestratorLines(sessionId) })
}

/**
 * Register `waiterId` as the session's waiter and resolve with its answer:
 * lines already pending at once, otherwise the first of lines arriving, a newer
 * waiter, the session ending, or `holdMs` passing.
 */
export function waitForOrchestratorLines(
  sessionId: string,
  waiterId: string,
  holdMs: number,
): Promise<WaiterAnswer> {
  waiters.get(sessionId)?.answer({ status: 'superseded' })
  return new Promise<WaiterAnswer>((resolve) => {
    const timer = setTimeout(() => settle({ status: 'empty' }), holdMs)
    timer.unref?.()
    const settle = (answer: WaiterAnswer): void => {
      clearTimeout(timer)
      if (waiters.get(sessionId)?.id === waiterId) waiters.delete(sessionId)
      resolve(answer)
    }
    waiters.set(sessionId, { id: waiterId, answer: settle })
    answerOrchestratorWaiter(sessionId)
  })
}

/** A session ended: answer its waiter `ended` and drop whatever it never heard. */
export function endOrchestratorMessages(sessionId: string): void {
  pending.delete(sessionId)
  const waiter = waiters.get(sessionId)
  waiters.delete(sessionId)
  waiter?.answer({ status: 'ended' })
}
