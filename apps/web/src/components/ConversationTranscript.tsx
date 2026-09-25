import type { CSSProperties } from 'react'
import type { AgentRuntime } from '@runcastle/core'
import { trpc } from '../trpc'
import { agentName } from '../lib/vocabulary'
import { DimLine, cx } from '../ui'
import { IconClaude, IconCodex, IconUser } from '../icons'
import { Markdown } from './Markdown'

/** One side of an exchange, as the server read it off disk. */
interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * One past project conversation, read back (decision 5). An ended chat keeps its
 * transcript, so "what did I already say to it?" is answerable without reopening
 * a terminal — which would resume the conversation, not show it.
 *
 * Read-only and deliberately plain: speaker-labelled turns, no tool traffic. Every
 * state it cannot show is one dim line naming the case (decisions.md #11); they
 * used to be paragraphs explaining where transcripts live, which nobody needs
 * twice.
 *
 * The server reads the transcript in whichever format the session's runtime
 * writes, and hands that runtime back with the turns — so the turns are
 * labelled with the name of whoever actually answered (decision 11).
 */
export function ConversationTranscript({
  sessionId,
  className,
}: {
  sessionId: string
  /** Replaces the default self-scrolling box, for a surface that scrolls itself. */
  className?: string
}) {
  const q = trpc.project.conversationTranscript.useQuery({ sessionId })

  if (q.isPending) return <DimLine>Reading the transcript…</DimLine>
  // A format we could not read (decision 10): the record exists, so "cleared or
  // never written" would be a lie, and the parse failure is ours to own rather
  // than the human's to debug.
  if (q.data?.status === 'unavailable')
    return <DimLine>Transcript not available for this session.</DimLine>
  const turns = q.data?.turns ?? []
  if (turns.length === 0) return <DimLine>No transcript kept for this conversation.</DimLine>

  return (
    <TranscriptBubbles
      turns={turns}
      assistant={agentName(q.data?.runtime)}
      runtime={q.data?.runtime}
      {...(className ? { className } : {})}
    />
  )
}

/** The box the turns scroll inside, where the surface does not scroll itself. */
const BUBBLES_BOX = 'flex max-h-[clamp(300px,calc(100dvh-340px),1200px)] flex-col gap-6 overflow-y-auto pr-1'

/**
 * The exchange itself, read like a chat. Each turn is a small speaker label —
 * the runtime's glyph and name for the agent, a person for you — over its
 * words at reading size (`text-base`). The agent's turns render as Markdown,
 * because they are written as Markdown and used to show their `##` and `**`
 * literally; yours is what you typed, plain text with its line breaks kept, on
 * the inset ground so "what did I ask for?" is found by scanning for it.
 */
export function TranscriptBubbles({
  turns,
  assistant,
  runtime,
  className = BUBBLES_BOX,
}: {
  turns: Turn[]
  assistant: string
  /** The runtime that answered — picks the agent's glyph. */
  runtime?: AgentRuntime | null
  className?: string
}) {
  const Agent = runtime === 'codex' ? IconCodex : IconClaude
  return (
    <div className={className}>
      {turns.map((turn, i) => {
        const user = turn.role === 'user'
        return (
          <article
            key={i}
            style={i < 8 ? ({ '--i': i } as CSSProperties) : undefined}
            className={cx('flex flex-col gap-1.5 animate-rise-in', i < 8 && '[animation-delay:calc(var(--i)*20ms)]')}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
              {user ? (
                <IconUser size={14} className="shrink-0 text-icon" />
              ) : (
                <Agent size={14} className="shrink-0 text-icon" />
              )}
              {user ? 'You' : assistant}
            </span>
            {user ? (
              <div className="rounded-md bg-surface-inset px-3 py-2 text-base break-words whitespace-pre-wrap text-text">
                {turn.text}
              </div>
            ) : (
              // The prose is the app's one Markdown renderer; `!` lifts its
              // 13px secondary UI face to the reading size a transcript wants.
              <Markdown source={turn.text} className="text-base! text-text!" />
            )}
          </article>
        )
      })}
    </div>
  )
}
