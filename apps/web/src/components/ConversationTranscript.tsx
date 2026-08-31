import { trpc } from '../trpc'
import { agentName } from '../lib/vocabulary'
import { DimLine } from '../ui'
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
 * Read-only and deliberately plain: alternating bubbles, no tool traffic. Every
 * state it cannot show is one dim line naming the case (decisions.md #11); they
 * used to be paragraphs explaining where transcripts live, which nobody needs
 * twice.
 *
 * The server reads the transcript in whichever format the session's runtime
 * writes, and hands that runtime back with the turns — so the bubbles are
 * labelled with the name of whoever actually answered (decision 11).
 */
export function ConversationTranscript({ sessionId }: { sessionId: string }) {
  const q = trpc.project.conversationTranscript.useQuery({ sessionId })

  if (q.isPending) return <DimLine>reading the transcript…</DimLine>
  // A format we could not read (decision 10): the record exists, so "cleared or
  // never written" would be a lie, and the parse failure is ours to own rather
  // than the human's to debug.
  if (q.data?.status === 'unavailable')
    return <DimLine>transcript not available for this session.</DimLine>
  const turns = q.data?.turns ?? []
  if (turns.length === 0) return <DimLine>no transcript kept for this conversation.</DimLine>
  // The server hands back what was said, with the launcher's kickoff lines taken
  // out. A conversation nobody answered leaves only the reply that kickoff drew,
  // which is not an exchange the human was part of — say so instead of rendering
  // half of one.
  if (!turns.some((turn) => turn.role === 'user'))
    return <DimLine>nothing was said in this conversation.</DimLine>

  return <TranscriptBubbles turns={turns} assistant={agentName(q.data?.runtime)} />
}

/**
 * The exchange itself. The human's own turns sit right and accented — a
 * transcript you are scanning for "what did I ask for?" is read by finding your
 * own side of it — and the agent's render as Markdown, because they are written
 * as Markdown and used to show their `##` and `**` literally. A human's turn is
 * what they typed, so it stays plain text with its line breaks kept.
 */
export function TranscriptBubbles({ turns, assistant }: { turns: Turn[]; assistant: string }) {
  return (
    <div className="flex max-h-[clamp(300px,calc(100dvh-340px),1200px)] flex-col gap-4 overflow-y-auto pr-1">
      {turns.map((turn, i) => {
        const user = turn.role === 'user'
        return (
          <div
            key={i}
            className={`flex max-w-[80%] flex-col gap-1.5 ${user ? 'self-end' : 'self-start'}`}
          >
            <span className="text-xs font-semibold tracking-[0.06em] text-text-3 uppercase">
              {user ? 'You' : assistant}
            </span>
            {user ? (
              <div className="rounded-lg rounded-tr-sm border border-accent-line bg-accent-soft px-4 py-3 text-base leading-relaxed break-words whitespace-pre-wrap text-text">
                {turn.text}
              </div>
            ) : (
              // The box is ours; the prose inside it is the app's one Markdown
              // renderer, typography and all, so this sets no type utilities the
              // `.md` rules would silently win over.
              <div className="rounded-lg rounded-tl-sm border border-hairline bg-panel px-4 py-3">
                <Markdown source={turn.text} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
