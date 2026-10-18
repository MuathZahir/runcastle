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
 * A waiter is never answered the instant a line arrives: lines are gathered for
 * {@link ORCHESTRATOR_GATHER_MS} from the first one queued, because a waiter
 * that exits takes until the next turn end to come back. A burn's review ticket
 * and the burn itself end ~20 ms apart; answering on the first line woke the
 * orchestrator twice, ~20 s apart, for what ended together.
 *
 * In memory on purpose: a server restart ends every terminal, and the catch-up
 * briefing covers what a relaunched orchestrator missed.
 *
 * A feature's lead (`the-feature-lead-runs-rounds` decision 12) uses the same
 * store under {@link leadMessageKey} rather than its session id: the feature has
 * one conversation across many session rows, and a message that arrives while
 * one row is ending must survive into the headless resume that follows it. A
 * lead's waiter is let go without its lines ({@link releaseOrchestratorWaiter}),
 * never ended with them dropped.
 */

/** The store key a feature lead's messages and waiter live under. */
export function leadMessageKey(featureId: string): string {
  return `lead:${featureId}`
}

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

/** How long lines are gathered, from the first one queued, before a waiter is answered. */
export const ORCHESTRATOR_GATHER_MS = 300

interface Pending {
  lines: string[]
  firstQueuedAt: number
}

const pending = new Map<string, Pending>()
const waiters = new Map<string, Waiter>()
const gathering = new Map<string, ReturnType<typeof setTimeout>>()

/** Add one line to a session's pending message. */
export function queueOrchestratorLine(sessionId: string, line: string): void {
  const batch = pending.get(sessionId)
  if (batch) batch.lines.push(line)
  else pending.set(sessionId, { lines: [line], firstQueuedAt: Date.now() })
}

/** Take every pending line for a session, oldest first; nothing is left behind. */
export function takeOrchestratorLines(sessionId: string): string[] {
  const lines = pending.get(sessionId)?.lines ?? []
  pending.delete(sessionId)
  return lines
}

/** Put lines a delivery took and could not hand over back at the front, oldest first. */
export function requeueOrchestratorLines(sessionId: string, lines: string[]): void {
  if (lines.length === 0) return
  const batch = pending.get(sessionId)
  if (batch) batch.lines.unshift(...lines)
  else pending.set(sessionId, { lines: [...lines], firstQueuedAt: Date.now() })
}

/** Whether a session has any line pending. */
export function hasOrchestratorLines(sessionId: string): boolean {
  return Boolean(pending.get(sessionId)?.lines.length)
}

/**
 * Hand a session's pending lines to its waiter, if it has one and there are
 * any — once the gathering window from the first pending line has passed, so
 * lines that end together go in the same answer.
 */
export function answerOrchestratorWaiter(sessionId: string): void {
  const waiter = waiters.get(sessionId)
  const batch = pending.get(sessionId)
  if (!waiter || !batch?.lines.length || gathering.has(sessionId)) return
  const wait = batch.firstQueuedAt + ORCHESTRATOR_GATHER_MS - Date.now()
  if (wait > 0) {
    const timer = setTimeout(() => {
      gathering.delete(sessionId)
      answerOrchestratorWaiter(sessionId)
    }, wait)
    timer.unref?.()
    gathering.set(sessionId, timer)
    return
  }
  waiters.delete(sessionId)
  waiter.answer({ status: 'lines', lines: takeOrchestratorLines(sessionId) })
}

/**
 * Register `waiterId` as the session's waiter and resolve with its answer:
 * lines already pending (once their gathering window has passed), otherwise the
 * first of lines arriving (gathered the same way), a newer
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

/**
 * Let a waiter go without handing it anything — `superseded` while its session
 * starts a turn (a lead's message waits for the turn's end), `ended` when the
 * session goes — and keep every pending line for whoever takes them next.
 */
export function releaseOrchestratorWaiter(sessionId: string, status: 'superseded' | 'ended'): void {
  clearTimeout(gathering.get(sessionId))
  gathering.delete(sessionId)
  const waiter = waiters.get(sessionId)
  waiters.delete(sessionId)
  waiter?.answer({ status })
}

/** A session ended: answer its waiter `ended` and drop whatever it never heard. */
export function endOrchestratorMessages(sessionId: string): void {
  pending.delete(sessionId)
  clearTimeout(gathering.get(sessionId))
  gathering.delete(sessionId)
  const waiter = waiters.get(sessionId)
  waiters.delete(sessionId)
  waiter?.answer({ status: 'ended' })
}
