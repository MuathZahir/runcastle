import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ThreadEvent, type ThreadEventBody } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { publishLive } from '../services/bus'

/**
 * The thread log (chat-as-web-components; ADR-0015): one JSONL file per thread
 * in its session dir, one {@link ThreadEvent} per line, append-only. It is the
 * thread's record — opening a thread folds it with no agent process involved —
 * so it must stay readable whatever happened to the process that wrote it.
 */

/** Where a thread's log lives. */
export function threadLogPath(threadId: string): string {
  return join(sessionDir(threadId), 'thread.jsonl')
}

/** Whether the thread has a log at all; a terminal-era conversation has none. */
export function hasThreadLog(threadId: string): boolean {
  return existsSync(threadLogPath(threadId))
}

/**
 * How long consecutive chunks of one message may keep joining the event they
 * started. A model streams a token at a time; one event per token would flood
 * both the log and the live bus for no reader's benefit.
 */
export const CHUNK_COALESCE_MS = 100

type Chunk = Extract<ThreadEvent, { type: 'agent_text' | 'thought' }>

interface LogState {
  /** The index the next event gets. */
  next: number
  /** A chunk still taking joiners, written once its window closes or anything else arrives. */
  pending?: { event: Chunk; timer: ReturnType<typeof setTimeout> }
}

const STATE_KEY = Symbol.for('runcastle.threads.log')
type GlobalWithLog = typeof globalThis & { [STATE_KEY]?: Map<string, LogState> }

/** Per-thread state, pinned on `globalThis` so a `bun --hot` reload keeps the indices. */
function states(): Map<string, LogState> {
  const g = globalThis as GlobalWithLog
  if (!g[STATE_KEY]) g[STATE_KEY] = new Map()
  return g[STATE_KEY]
}

/** The thread's state, recovering the next index from the file on first use. */
function stateFor(threadId: string): LogState {
  let state = states().get(threadId)
  if (!state) {
    const events = readThreadEvents(threadId)
    state = { next: events.length ? events[events.length - 1].i + 1 : 0 }
    states().set(threadId, state)
  }
  return state
}

function chunkKey(body: ThreadEventBody): string | null {
  if (body.type === 'agent_text') return `text:${body.messageId}`
  if (body.type === 'thought') return `thought:${body.thoughtId}`
  return null
}

function write(threadId: string, event: ThreadEvent): void {
  const path = threadLogPath(threadId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`)
  publishLive({ kind: 'thread', threadId })
}

/** Write the thread's pending chunk, if one is waiting. */
export function flushThreadLog(threadId: string): void {
  const state = states().get(threadId)
  const pending = state?.pending
  if (!state || !pending) return
  clearTimeout(pending.timer)
  state.pending = undefined
  write(threadId, pending.event)
}

/**
 * Append one event to a thread's log and publish `{ kind: 'thread', threadId }`.
 * Assigns the next index and the timestamp.
 *
 * An `agent_text` or `thought` chunk is held for {@link CHUNK_COALESCE_MS}:
 * further chunks of the same message within that window join it, and it is
 * written when the window closes or when any other event arrives (which is
 * always written after it, so the log keeps arrival order). The event returned
 * for a held chunk is the joined one, and grows while the window is open.
 */
export function appendThreadEvent(threadId: string, body: ThreadEventBody): ThreadEvent {
  const state = stateFor(threadId)
  const key = chunkKey(body)
  const pending = state.pending
  if (key && pending && chunkKey(pending.event) === key && Date.now() - pending.event.at < CHUNK_COALESCE_MS) {
    pending.event.text += (body as Chunk).text
    return pending.event
  }
  flushThreadLog(threadId)
  const event = { ...body, i: state.next++, at: Date.now() } as ThreadEvent
  if (key) {
    const timer = setTimeout(() => flushThreadLog(threadId), CHUNK_COALESCE_MS)
    timer.unref?.()
    state.pending = { event: event as Chunk, timer }
  } else write(threadId, event)
  return event
}

/**
 * Start a new thread's log with `events` (a branch's copy of the conversation
 * it came from), re-indexed from 0 and keeping their times, so the copied turns
 * read back as long as they took.
 */
export function seedThreadLog(threadId: string, events: readonly ThreadEvent[]): void {
  const path = threadLogPath(threadId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, events.map((e, i) => `${JSON.stringify({ ...e, i })}\n`).join(''))
  states().set(threadId, { next: events.length })
  publishLive({ kind: 'thread', threadId })
}

/**
 * A thread's log, every event with an index greater than `after` (all when
 * omitted). A line that does not parse — a write torn by a crash, a hand edit —
 * is skipped: one bad line must never make a thread unopenable. Chunks still
 * held for coalescing are not in it yet; they arrive with their own signal.
 */
export function readThreadEvents(threadId: string, after?: number): ThreadEvent[] {
  let text: string
  try {
    text = readFileSync(threadLogPath(threadId), 'utf8')
  } catch {
    return []
  }
  const events: ThreadEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = ThreadEvent.safeParse(raw)
    if (parsed.success && (after === undefined || parsed.data.i > after)) events.push(parsed.data)
  }
  return events
}
