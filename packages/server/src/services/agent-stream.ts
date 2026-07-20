/**
 * In-memory per-ticket agent transcripts. The ticket-burner forwards every
 * sandcastle stream event here UNTHROTTLED (the events table only gets the
 * coarse `burn.text`/`burn.tool` timeline), so the UI can render a live
 * Claude Code-style transcript of what the agent is doing right now.
 *
 * Deliberately ephemeral (module-level Map, like the runner's AbortController
 * registry): the full token stream is bulky observability data, not record —
 * the durable record is the events table + the sandcastle log file on disk.
 * A server restart mid-burn loses the live transcript, not the run.
 *
 * Chunks are strictly append-only with a monotonically increasing index `i`,
 * so the tRPC reader can poll with an `after` cursor and never re-download
 * what it has. When a ticket's buffer exceeds the cap, oldest chunks are
 * dropped but indices keep counting — the reader sees `firstIndex` move and
 * knows earlier output was trimmed.
 */

export interface TranscriptChunk {
  /** Monotonic per-ticket index — the poll cursor. */
  i: number
  kind: 'text' | 'tool'
  /** Assistant text for `text`; formatted args for `tool`. */
  text: string
  /** Tool name — only for `kind: 'tool'`. */
  name?: string
  ts: number
}

export interface TranscriptRead {
  /** Is the agent for this ticket currently running? */
  live: boolean
  /** Chunks with `i > after`. */
  chunks: TranscriptChunk[]
  /** Index of the oldest retained chunk (0 unless the ring trimmed). */
  firstIndex: number
  /** Next index that will be assigned — total chunks ever appended. */
  nextIndex: number
}

interface Transcript {
  live: boolean
  chunks: TranscriptChunk[]
  nextIndex: number
  /** Sum of retained `text` lengths — the trim trigger. */
  bytes: number
}

/** Per-ticket retention: drop oldest beyond either bound. */
const MAX_CHUNKS = 4000
const MAX_BYTES = 1_500_000

const transcripts = new Map<string, Transcript>()

/** Start (or restart — a re-burn) a ticket's transcript: clears old content. */
export function beginTranscript(ticketId: string): void {
  transcripts.set(ticketId, { live: true, chunks: [], nextIndex: 0, bytes: 0 })
}

/** Append one chunk; trims oldest when over the retention caps. */
export function appendTranscript(
  ticketId: string,
  chunk: Omit<TranscriptChunk, 'i' | 'ts'> & { ts?: number },
): void {
  const t = transcripts.get(ticketId)
  if (!t) return
  const full: TranscriptChunk = { ...chunk, i: t.nextIndex, ts: chunk.ts ?? Date.now() }
  t.nextIndex += 1
  t.chunks.push(full)
  t.bytes += full.text.length
  while (t.chunks.length > MAX_CHUNKS || (t.bytes > MAX_BYTES && t.chunks.length > 1)) {
    const dropped = t.chunks.shift()
    if (!dropped) break
    t.bytes -= dropped.text.length
  }
}

/** Mark the ticket's agent finished; the transcript stays readable. */
export function endTranscript(ticketId: string): void {
  const t = transcripts.get(ticketId)
  if (t) t.live = false
}

/** Read chunks after the cursor. Unknown ticket → empty, not an error. */
export function readTranscript(ticketId: string, after = -1): TranscriptRead {
  const t = transcripts.get(ticketId)
  if (!t) return { live: false, chunks: [], firstIndex: 0, nextIndex: 0 }
  return {
    live: t.live,
    chunks: after < 0 ? [...t.chunks] : t.chunks.filter((c) => c.i > after),
    firstIndex: t.chunks[0]?.i ?? t.nextIndex,
    nextIndex: t.nextIndex,
  }
}

/** Test hook — reset the module state. */
export function clearAllTranscripts(): void {
  transcripts.clear()
}
