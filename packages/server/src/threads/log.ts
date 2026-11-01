import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
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

type Chunk = Extract<ThreadEvent, { type: 'agent_text' | 'thought' | 'tool' }>

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
  // A command's streamed output, and nothing else about its call.
  if (body.type === 'tool' && body.outputAppend !== undefined && Object.keys(body.call).length === 1) {
    return `output:${body.call.id}`
  }
  return null
}

/** Join a chunk to the held one of the same key. */
function joinChunk(held: Chunk, body: ThreadEventBody): void {
  if (held.type === 'tool' && body.type === 'tool') held.outputAppend = (held.outputAppend ?? '') + (body.outputAppend ?? '')
  else if (held.type !== 'tool' && (body.type === 'agent_text' || body.type === 'thought')) held.text += body.text
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
 * An `agent_text` or `thought` chunk, or a command's streamed output, is held
 * for {@link CHUNK_COALESCE_MS}: further chunks of the same message (or the same
 * command) within that window join it, and it is
 * written when the window closes or when any other event arrives (which is
 * always written after it, so the log keeps arrival order). The event returned
 * for a held chunk is the joined one, and grows while the window is open.
 */
export function appendThreadEvent(threadId: string, body: ThreadEventBody): ThreadEvent {
  const state = stateFor(threadId)
  const key = chunkKey(body)
  const pending = state.pending
  if (key && pending && chunkKey(pending.event) === key && Date.now() - pending.event.at < CHUNK_COALESCE_MS) {
    joinChunk(pending.event, body)
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
  tails().delete(path)
  publishLive({ kind: 'thread', threadId })
}

/** A log as read so far: its events, and how many bytes of the file they came from. */
interface Tail {
  events: ThreadEvent[]
  offset: number
}

const TAILS_KEY = Symbol.for('runcastle.threads.log.tails')
type GlobalWithTails = typeof globalThis & { [TAILS_KEY]?: Map<string, Tail> }

/** Keyed by path: a thread's log is reached by a data dir as well as an id. */
function tails(): Map<string, Tail> {
  const g = globalThis as GlobalWithTails
  if (!g[TAILS_KEY]) g[TAILS_KEY] = new Map()
  return g[TAILS_KEY]
}

/** The event on a line, or null for one that does not parse: a write torn by a crash, a hand edit. */
function parseLine(line: string): ThreadEvent | null {
  if (!line.trim()) return null
  try {
    const parsed = ThreadEvent.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The events a thread's log holds now, reading only what was added since the
 * last read: every open thread, the thread lists and the waiting flag read the
 * log on every signal, and it only ever grows. It starts over if the file shrank.
 * The bytes after the last newline may be a line still being written, so they are
 * read every time and kept only once a newline ends them.
 */
function loggedEvents(threadId: string): readonly ThreadEvent[] {
  const path = threadLogPath(threadId)
  let size: number
  try {
    size = statSync(path).size
  } catch {
    tails().delete(path)
    return []
  }
  let tail = tails().get(path)
  if (!tail || size < tail.offset) {
    tail = { events: [], offset: 0 }
    tails().set(path, tail)
  }
  if (size === tail.offset) return tail.events
  const added = Buffer.alloc(size - tail.offset)
  const file = openSync(path, 'r')
  try {
    readSync(file, added, 0, added.length, tail.offset)
  } finally {
    closeSync(file)
  }
  const end = added.lastIndexOf(0x0a) + 1
  for (const line of added.toString('utf8', 0, end).split('\n')) {
    const event = parseLine(line)
    if (event) tail.events.push(event)
  }
  tail.offset += end
  const last = end < added.length ? parseLine(added.toString('utf8', end)) : null
  return last ? [...tail.events, last] : tail.events
}

/**
 * A thread's log, every event with an index greater than `after` (all when
 * omitted). A line that does not parse is skipped: one bad line must never make
 * a thread unopenable. Chunks still held for coalescing are not in it yet; they
 * arrive with their own signal.
 */
export function readThreadEvents(threadId: string, after?: number): ThreadEvent[] {
  const events = loggedEvents(threadId)
  return after === undefined ? [...events] : events.filter((e) => e.i > after)
}
