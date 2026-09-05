import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { RouterOutputs } from '../../lib/api'
import { useLivePoll } from '../../lib/live'
import { transcriptBlocks } from '../../lib/feature-ui/run'
import { fmtTime } from '../../lib/format'
import { DimLine } from '../../ui'

type TranscriptChunk = RouterOutputs['run']['agentTranscript']['chunks'][number]

/**
 * One lane's agent transcript, inside the lane's own expansion (decision #10) —
 * the shared Agent|Events pane it used to fill is gone, because a transcript
 * pinned to one ticket beside every ticket's lane made the human hold which
 * lane they were reading in their head.
 *
 * Rendered agent-style: assistant prose as `⏺` blocks, tool calls as `●` lines,
 * an activity footer while the agent is live. Polls the server's in-memory
 * transcript (`run.agentTranscript`) at 1s with a chunk-index cursor, so each
 * poll only downloads what's new.
 *
 * Two hygiene rules apply on the way out (decision #13). The burner's wire
 * protocol is swallowed: `<promise>COMPLETE</promise>` was the agent's last
 * words on screen, and it is a marker for the harness, not prose — it becomes a
 * small "agent reported complete" line instead. And container paths are
 * rewritten repo-relative, because the sandbox's own layout says nothing to the
 * human reading the lane.
 *
 * Mount keyed by ticketId — the accumulated log resets when a lane re-burns.
 */
export function LaneTranscript({
  ticketId,
  bootEvents,
  poll = true,
}: {
  ticketId: string
  /** This lane's own events, narrating the container while the agent is silent. */
  bootEvents: readonly EventRow[]
  /**
   * Off on a run record: the transcript of a finished run either is in memory
   * or never will be, and a second-by-second poll for output that cannot arrive
   * is the kind of standing cost a history view should not carry.
   */
  poll?: boolean
}) {
  const { chunks, live, trimmed } = useTicketTranscript(ticketId, poll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const { blocks, completed } = useMemo(() => transcriptBlocks(chunks), [chunks])

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
    <div
      className="max-h-120 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
      ref={scrollRef}
      onScroll={onScroll}
    >
      {trimmed && <div className="pb-2 text-center text-xs text-text-4">… earlier output trimmed …</div>}
      {blocks.length === 0 && !live && (
        <DimLine>
          no agent output captured — transcripts are held in server memory for the current burn;
          older runs keep only the event timeline.
        </DimLine>
      )}
      {/* The container takes 15–20s to come up, and "waiting for the agent's
          first output…" over a blank pane read as a hung lane. Its own boot
          narrative is what is actually happening (decision #10). */}
      {blocks.length === 0 && live && <BootNarrative events={bootEvents} />}
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <div key={i} className="mb-2.5 flex items-start gap-2">
            <span className="shrink-0 text-text-2">⏺</span>
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-text">{b.text}</span>
          </div>
        ) : (
          <div key={i} className="mb-1.5 flex items-start gap-2">
            <span className="shrink-0 text-ok">●</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-text">{b.name}</span>
              {b.args && <span className="text-text-3">({b.args})</span>}
            </span>
          </div>
        ),
      )}
      {completed && (
        <div className="mt-1 flex items-center gap-2 text-xs text-text-3">
          <span className="text-ok">✓</span>
          agent reported complete
        </div>
      )}
      {live && (
        <div className="mt-1 flex items-center gap-2 text-ph-implementation">
          <span className="inline-block animate-[spin_1.2s_linear_infinite]">✳</span>
          <span className="text-xs text-text-3">Burning…</span>
          <span className="animate-[pulse_1.1s_ease-in-out_infinite] text-text-2">▍</span>
        </div>
      )}
      {!following && (
        <button
          className="sticky bottom-1.5 ml-auto block cursor-pointer rounded-pill border border-accent bg-panel-2 px-2.5 text-xs text-accent-hi"
          onClick={() => setFollowing(true)}
        >
          Follow ⇣
        </button>
      )}
    </div>
  )
}

/** What the container is doing while the agent has not spoken yet. */
function BootNarrative({ events }: { events: readonly EventRow[] }) {
  if (events.length === 0) return <DimLine>starting the container…</DimLine>
  return (
    <div className="flex flex-col gap-1">
      {events.map((e) => (
        <div key={e.id} className="flex gap-2.5 text-xs text-text-3">
          <span className="shrink-0 text-text-4">{fmtTime(e.ts)}</span>
          <span className="min-w-0 flex-1 break-words">{e.message}</span>
        </div>
      ))}
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
function useTicketTranscript(ticketId: string, poll: boolean): TranscriptState {
  const [chunks, setChunks] = useState<TranscriptChunk[]>([])
  const [live, setLive] = useState(false)
  const [trimmed, setTrimmed] = useState(false)

  const after = chunks.length > 0 ? chunks[chunks.length - 1].i : undefined
  const interval = useLivePoll(1000)
  const query = trpc.run.agentTranscript.useQuery(
    { ticketId, after },
    { refetchInterval: poll ? interval : false },
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

