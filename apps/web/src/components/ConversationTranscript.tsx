import { trpc } from '../trpc'
import { DimLine } from '../ui'

/**
 * One past project conversation, read back (decision 5). An ended chat keeps its
 * transcript, so "what did I already say to it?" is answerable without reopening
 * a terminal — which would resume the conversation, not show it.
 *
 * Read-only and deliberately plain: alternating bubbles, no tool traffic, no
 * markdown. It answers a recall question, it is not a second terminal.
 */
export function ConversationTranscript({ sessionId }: { sessionId: string }) {
  const q = trpc.project.conversationTranscript.useQuery({ sessionId })

  if (q.isPending) return <DimLine>reading the transcript…</DimLine>
  const turns = q.data ?? []
  if (turns.length === 0)
    return (
      <DimLine>
        no transcript for this conversation — Claude Code keeps them on disk, and this one has been
        cleared or was never written.
      </DimLine>
    )
  // The server hands back what was said, with the launcher's kickoff lines taken
  // out. A conversation nobody answered leaves only the reply that kickoff drew,
  // which is not an exchange the human was part of — say so instead of rendering
  // half of one.
  if (!turns.some((turn) => turn.role === 'user'))
    return (
      <DimLine>
        nothing was said in this conversation — it opened and closed before you typed anything.
      </DimLine>
    )

  return (
    <div className="convo-transcript">
      {turns.map((turn, i) => (
        <div key={i} className={`convo-bubble is-${turn.role}`}>
          <div className="convo-bubble-role">{turn.role === 'user' ? 'You' : 'Claude'}</div>
          <div className="convo-bubble-text">{turn.text}</div>
        </div>
      ))}
    </div>
  )
}
