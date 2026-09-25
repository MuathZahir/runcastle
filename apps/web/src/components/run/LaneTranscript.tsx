import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRuntime, EventRow } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { RouterOutputs } from '../../lib/api'
import { useLivePoll } from '../../lib/live'
import { transcriptBlocks } from '../../lib/feature-ui/run'
import type { TranscriptBlock } from '../../lib/feature-ui/run'
import { fmtTime } from '../../lib/format'
import { agentName } from '../../lib/vocabulary'
import { Button, DimLine, StatusLabel } from '../../ui'
import { IconCheck, IconChevronDown, IconChevronRight, IconClaude, IconCodex } from '../../icons'
import { Markdown } from '../Markdown'

type TranscriptChunk = RouterOutputs['run']['agentTranscript']['chunks'][number]

const RUNTIME_ICON: Record<AgentRuntime, typeof IconClaude> = {
  'claude-code': IconClaude,
  codex: IconCodex,
}

/**
 * One lane's agent transcript, inside the lane's own expansion (decision #10) —
 * the shared Agent|Events pane it used to fill is gone, because a transcript
 * pinned to one ticket beside every ticket's lane made the human hold which
 * lane they were reading in their head.
 *
 * Read like a chat: the agent named once at the top with its runtime's glyph,
 * its prose as Markdown at reading size, each tool call one quiet line that
 * opens to its full arguments. Blocks rise in as they arrive; ones already on
 * screen never re-animate (they keep their key as the stream appends). Polls
 * the server's in-memory transcript (`run.agentTranscript`) at 1s with a
 * chunk-index cursor, so each poll only downloads what's new.
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
  runtime,
  poll = true,
}: {
  ticketId: string
  /** This lane's own events, narrating the container while the agent is silent. */
  bootEvents: readonly EventRow[]
  /** Who is speaking — the runtime the lane burns on. */
  runtime?: AgentRuntime
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

  const Speaker = runtime ? RUNTIME_ICON[runtime] : null
  const speaking = blocks.length > 0 || live

  return (
    <div
      className="relative max-h-120 overflow-y-auto rounded-md bg-surface-inset px-4 py-3"
      ref={scrollRef}
      onScroll={onScroll}
    >
      {trimmed && <div className="pb-2 text-center text-xs text-text-tertiary">Earlier output trimmed</div>}
      {!speaking && (
        <DimLine>
          No agent output captured — transcripts are held in server memory for the current burn;
          older runs keep only the event timeline.
        </DimLine>
      )}
      {speaking && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          {Speaker && <Speaker size={14} className="shrink-0 text-icon" />}
          {runtime ? agentName(runtime) : 'Agent'}
        </div>
      )}
      {/* The container takes 15–20s to come up, and "waiting for the agent's
          first output…" over a blank pane read as a hung lane. Its own boot
          narrative is what is actually happening (decision #10). */}
      {blocks.length === 0 && live && <BootNarrative events={bootEvents} />}
      {blocks.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {blocks.map((b, i) => (
            <TranscriptLine key={i} block={b} />
          ))}
        </div>
      )}
      {completed && (
        <div className="mt-2">
          <StatusLabel tone="success" icon={<IconCheck />}>
            Agent reported complete
          </StatusLabel>
        </div>
      )}
      {live && (
        <div className="mt-2">
          <StatusLabel tone="live">Burning…</StatusLabel>
        </div>
      )}
      {!following && (
        <div className="pointer-events-none sticky bottom-0 flex justify-end">
          <Button
            size="sm"
            icon={<IconChevronDown />}
            className="pointer-events-auto bg-surface-raised! shadow-popover animate-fade-in"
            onClick={() => setFollowing(true)}
          >
            Follow
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * One block of the stream. Prose is Markdown at reading size (`text-base`); a
 * tool call is a one-line disclosure — its name, then its arguments in quiet
 * mono — that opens to the arguments wrapped in full.
 */
function TranscriptLine({ block }: { block: TranscriptBlock }) {
  if (block.kind === 'text') {
    return (
      <div className="py-1 animate-rise-in">
        {/* `!`: the renderer states its own 13px secondary face, and a
            transcript is prose to read, not UI chrome. */}
        <Markdown source={block.text} className="text-base! text-text!" />
      </div>
    )
  }
  return (
    <details data-disclosure="" className="group/tool animate-rise-in">
      <summary
        className="flex h-6 min-w-0 cursor-pointer list-none items-center gap-1.5 text-xs select-none [&::-webkit-details-marker]:hidden"
        title={block.args || undefined}
      >
        <IconChevronRight
          size={12}
          className="shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-open/tool:rotate-90"
        />
        <span className="shrink-0 font-medium text-text-secondary">{block.name}</span>
        {block.args && <span className="min-w-0 truncate font-mono text-text-tertiary">{block.args}</span>}
      </summary>
      {block.args && (
        <pre className="m-0 mt-0.5 mb-1 ml-4.5 font-mono text-xs break-words whitespace-pre-wrap text-text-tertiary">
          {block.args}
        </pre>
      )}
    </details>
  )
}

/** What the container is doing while the agent has not spoken yet. */
function BootNarrative({ events }: { events: readonly EventRow[] }) {
  if (events.length === 0) return <DimLine>Starting the container…</DimLine>
  return (
    <div className="flex flex-col gap-1">
      {events.map((e) => (
        <div key={e.id} className="flex gap-3 text-xs animate-rise-in">
          <span className="shrink-0 text-text-tertiary tabular-nums">{fmtTime(e.ts)}</span>
          <span className="min-w-0 flex-1 break-words text-text-secondary">{e.message}</span>
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
