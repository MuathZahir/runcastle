import { useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '../trpc'
import type { RouterOutputs } from '../lib/api'
import { useLivePoll } from '../lib/live'
import { DimLine } from '../ui'

type TranscriptChunk = RouterOutputs['run']['agentTranscript']['chunks'][number]

/**
 * Live agent transcript for one burning ticket, rendered agent-style:
 * assistant prose as `⏺` blocks, tool calls as `●  Name(args)` lines, an
 * animated activity footer while the agent is live. Polls the server's
 * in-memory transcript (`run.agentTranscript`) at 1s with a chunk-index
 * cursor, so each poll only downloads what's new.
 *
 * Mount keyed by ticketId — the accumulated log resets when you switch lanes.
 */
export function AgentTranscript({ ticketId }: { ticketId: string }) {
  const { chunks, live, trimmed } = useTicketTranscript(ticketId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const blocks = useMemo(() => toBlocks(chunks), [chunks])

  useEffect(() => {
    if (!following) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [blocks, live, following])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setFollowing(atBottom)
  }

  return (
    <div className="agent-body" ref={scrollRef} onScroll={onScroll}>
      {trimmed && <div className="agent-trimmed">… earlier output trimmed …</div>}
      {blocks.length === 0 && !live && (
        <DimLine>
          no agent output captured — transcripts are held in server memory for the
          current burn; older runs keep only the event timeline.
        </DimLine>
      )}
      {blocks.length === 0 && live && <DimLine>waiting for the agent's first output…</DimLine>}
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <div key={i} className="agent-turn">
            <span className="agent-glyph is-text">⏺</span>
            <span className="agent-prose">{b.text}</span>
          </div>
        ) : (
          <div key={i} className="agent-turn is-tool">
            <span className="agent-glyph is-tool">●</span>
            <span className="agent-toolline">
              <span className="agent-toolname">{b.name}</span>
              {b.args && <span className="agent-toolargs">({b.args})</span>}
            </span>
          </div>
        ),
      )}
      {live && (
        <div className="agent-live-row">
          <span className="agent-spinner">✳</span>
          <span className="agent-live-label">Burning…</span>
          <span className="agent-cursor">▍</span>
        </div>
      )}
      {!following && (
        <button className="follow-pill agent-follow" onClick={() => setFollowing(true)}>
          Follow ⇣
        </button>
      )}
    </div>
  )
}

interface TranscriptState {
  chunks: TranscriptChunk[]
  live: boolean
  trimmed: boolean
}

/**
 * Cursor-accumulating poll (same pattern as `useEventLog`): the last chunk's
 * index is the `after` cursor, fresh chunks append. A `nextIndex` BEHIND our
 * cursor means the server transcript restarted (re-burn or server bounce) —
 * drop the local log and start over from the top.
 */
function useTicketTranscript(ticketId: string): TranscriptState {
  const [chunks, setChunks] = useState<TranscriptChunk[]>([])
  const [live, setLive] = useState(false)
  const [trimmed, setTrimmed] = useState(false)

  const after = chunks.length > 0 ? chunks[chunks.length - 1].i : undefined
  const query = trpc.run.agentTranscript.useQuery(
    { ticketId, after },
    { refetchInterval: useLivePoll(1000) },
  )

  useEffect(() => {
    const d = query.data
    if (!d) return
    setLive(d.live)
    setTrimmed(d.firstIndex > 0)
    setChunks((prev) => {
      const cursor = prev.length > 0 ? prev[prev.length - 1].i : -1
      if (d.nextIndex <= cursor) return [] // transcript reset — refetch from scratch
      if (d.chunks.length === 0) return prev
      const fresh = d.chunks.filter((c) => c.i > cursor)
      if (fresh.length === 0) return prev
      return [...prev, ...fresh]
    })
  }, [query.data])

  return { chunks, live, trimmed }
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; args: string }

/**
 * Consecutive raw text chunks merge into one prose block (the stream slices
 * text arbitrarily); tool calls stay one line each. Blank-only text is dropped.
 */
function toBlocks(chunks: TranscriptChunk[]): Block[] {
  const out: Block[] = []
  for (const c of chunks) {
    if (c.kind === 'tool') {
      out.push({ kind: 'tool', name: c.name ?? 'tool', args: oneLine(c.text) })
      continue
    }
    const last = out[out.length - 1]
    if (last && last.kind === 'text') last.text += c.text
    else out.push({ kind: 'text', text: c.text })
  }
  return out
    .map((b) => (b.kind === 'text' ? { ...b, text: b.text.trim() } : b))
    .filter((b) => (b.kind === 'text' ? b.text.length > 0 : true))
}

/** Collapse a tool-arg payload to one displayable line. */
function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}
