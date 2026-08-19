import { trpc } from '../trpc'
import { agentName } from '../lib/vocabulary'
import { DimLine } from '../ui'

/**
 * One past project conversation, read back (decision 5). An ended chat keeps its
 * transcript, so "what did I already say to it?" is answerable without reopening
 * a terminal — which would resume the conversation, not show it.
 *
 * Read-only and deliberately plain: alternating bubbles, no tool traffic, no
 * markdown. It answers a recall question, it is not a second terminal.
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
  if (turns.length === 0)
    return (
      <DimLine>
        no transcript for this conversation — they are kept on disk by the agent that ran it, and
        this one has been cleared or was never written.
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

  const assistant = agentName(q.data?.runtime)

  return (
    <div className="convo-transcript">
      {turns.map((turn, i) => (
        <div key={i} className={`convo-bubble is-${turn.role}`}>
          <div className="convo-bubble-role">{turn.role === 'user' ? 'You' : assistant}</div>
          <div className="convo-bubble-text">{turn.text}</div>
        </div>
      ))}
    </div>
  )
}
