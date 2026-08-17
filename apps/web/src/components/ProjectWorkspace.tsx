import { useState } from 'react'
import { trpc } from '../trpc'
import { IconBranch, IconMessage } from '../icons'
import { Button, DimLine, SessionStatusDot } from '../ui'
import type { ProjectConversation } from '../lib/api'
import { sessionStatusLabel } from '../lib/feature-ui'
import { fmtDateTime } from '../lib/format'
import { projectStats } from '../lib/projects'
import { useLivePoll } from '../lib/live'
import { PROJECT_BRANCH, projectBranchNote } from '../lib/project-workspace'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { ConversationTranscript } from './ConversationTranscript'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in.
 *
 * This is the one surface in the shell bound to a project rather than a feature:
 * the project's CONVERSATIONS, framed by what they read (the charter and the
 * feature index) and by where their commits go. The chrome states the branch and
 * its consequence up front, because unlike every other terminal in runcastle
 * this one writes the repo for real — on a runcastle-owned branch, landing on
 * the base branch, arriving in the human's checkout like a pull.
 *
 * A list, not a terminal, is the resting state (decision 5). Opening the chat
 * used to silently resume one endless conversation, so there was no way to start
 * a clean one and no way back to an old one. Now: New chat is the prominent
 * default, past conversations are named and dated, reopening one is a click on
 * that one, and an ended conversation can be read without being reopened. Only
 * one runs at a time — the launcher's rule — so a live conversation takes the
 * body over, exactly as the single session used to.
 */
export function ProjectWorkspace({
  projectId,
  talk,
}: {
  projectId: string
  talk: ProjectTalkApi
}) {
  const utils = trpc.useUtils()
  // Same query key the nav already polls, so this costs no extra fetch.
  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)
  // Same key (and interval) as the rail's own poll — one fetch, two readers.
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const stats = projectStats(featuresQ.data ?? [])
  const inFlight = stats.total - stats.shipped
  const session = talk.session
  // The conversation being read back, if any. Cleared whenever a session goes
  // live: the terminal owns the body then, and coming back out should land on
  // the list rather than on whatever was open before.
  const [viewing, setViewing] = useState<ProjectConversation | null>(null)
  const reading = session ? null : viewing

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <span className="pw-tag">PROJECT</span>
          <span className="ws-title">{project?.name ?? 'This project'}</span>
          <span className="ws-title-spacer" />
          <span className="ws-branch is-static" title="the branch this session works on">
            <IconBranch size={11} />
            {PROJECT_BRANCH}
          </span>
        </div>
        <div className="pw-consequence">{projectBranchNote(project?.mainBranch ?? '')}</div>
      </div>

      <div className="ws-body">
        <div className="ws-body-inner">
          {session ? (
            <>
              <SessionFrame stats={stats} inFlight={inFlight} />
              <div className="grill-panel pw-session">
                <div className="grill-strip">
                  <span className="grill-kind">
                    {titleFor(talk.conversations, session.id) ?? 'project'}
                  </span>
                  <SessionStatusDot status={session.status} />
                  <span className="grill-live-label">{sessionStatusLabel(session)}</span>
                  <span className="grill-strip-spacer" />
                  <span className="grill-sid" title={session.ccSessionId ?? session.id}>
                    {(session.ccSessionId ?? session.id).slice(0, 8)}
                  </span>
                  <EndSessionButton
                    sessionId={session.id}
                    onEnded={() => {
                      void utils.project.projectSession.invalidate()
                      void utils.project.conversations.invalidate()
                    }}
                  />
                </div>
                <div className="grill-term pw-term">
                  <ErrorBoundary label="terminal">
                    <TerminalView sessionId={session.id} />
                  </ErrorBoundary>
                </div>
              </div>
            </>
          ) : reading ? (
            <ReadingPane
              conversation={reading}
              onBack={() => setViewing(null)}
              onReopen={() => talk.resume(reading.id)}
              reopening={talk.starting}
            />
          ) : (
            <>
              <NewChatCard onStart={talk.start} starting={talk.starting} />
              <ConversationList
                conversations={talk.conversations}
                pending={talk.conversationsPending}
                busy={talk.starting}
                onResume={talk.resume}
                onView={setViewing}
              />
              <SessionFrame stats={stats} inFlight={inFlight} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** The conversation's name, once the list knows it. */
function titleFor(conversations: ProjectConversation[], sessionId: string): string | null {
  return conversations.find((c) => c.id === sessionId)?.title ?? null
}

/**
 * What the conversation already knows before you type. Doc contents are a later
 * slice — the count and the charter's whereabouts are what make a chat legible.
 */
function SessionFrame({
  stats,
  inFlight,
}: {
  stats: { total: number; shipped: number }
  inFlight: number
}) {
  return (
    <div className="pw-frame">
      <div className="pw-frame-head">What every chat here already has</div>
      <ul className="pw-frame-list">
        <li>
          <b>
            {stats.total} feature{stats.total === 1 ? '' : 's'}
          </b>{' '}
          as a one-line index — {inFlight} in flight, {stats.shipped} shipped.
        </li>
        <li>
          The project charter (<code>CONTEXT.md</code>) and the decision log, when the repo has them.
        </li>
        <li>
          Every merged feature’s docs, already on disk in its worktree — it can read them without
          asking.
        </li>
      </ul>
    </div>
  )
}

/** The default action, and the only one on a project nobody has talked to yet. */
function NewChatCard({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <div className="pw-newchat">
      <div className="pw-newchat-copy">
        <div className="pw-rest-title">Talk it through</div>
        <div className="pw-rest-sub">
          Bring a lump of raw intent. The chat looks at what this project has already built and
          decided, asks what it needs to, suggests how to split the work — then creates the
          features.
        </div>
      </div>
      <Button variant="solid" disabled={starting} onClick={onStart}>
        {starting ? 'Opening…' : 'New chat'}
      </Button>
    </div>
  )
}

/**
 * Past conversations, newest first. Resuming is a click on the conversation you
 * mean and never the default — the complaint this whole surface answers is that
 * opening the chat resumed one endless thread nobody chose.
 */
function ConversationList({
  conversations,
  pending,
  busy,
  onResume,
  onView,
}: {
  conversations: ProjectConversation[]
  pending: boolean
  busy: boolean
  onResume: (sessionId: string) => void
  onView: (conversation: ProjectConversation) => void
}) {
  if (pending) return null
  if (conversations.length === 0)
    return <DimLine>No conversations yet — the first one starts above.</DimLine>

  return (
    <div className="pw-convos">
      <div className="pw-frame-head">Past conversations</div>
      {conversations.map((c) => (
        <div key={c.id} className="pw-convo">
          <span className="pw-convo-glyph">
            <IconMessage size={13} />
          </span>
          <span className="pw-convo-main">
            <span className="pw-convo-title">{c.title}</span>
            <span className="pw-convo-when">
              {c.createdAt ? fmtDateTime(c.createdAt) : 'date unknown'}
              {c.status !== 'ended' && ' · open'}
            </span>
          </span>
          <button className="btn btn-ghost btn-xs" onClick={() => onView(c)}>
            Transcript
          </button>
          {/* A conversation Claude Code never picked up has nothing to resume —
              reopening it would silently be a new chat, so it does not offer. */}
          <button
            className="btn btn-ghost btn-xs"
            disabled={busy || !c.resumable}
            title={c.resumable ? 'continue this conversation' : 'this one never got started'}
            onClick={() => onResume(c.id)}
          >
            Reopen
          </button>
        </div>
      ))}
    </div>
  )
}

/** One conversation, read back — with the way out of it and the way into it. */
function ReadingPane({
  conversation,
  onBack,
  onReopen,
  reopening,
}: {
  conversation: ProjectConversation
  onBack: () => void
  onReopen: () => void
  reopening: boolean
}) {
  return (
    <div className="pw-reading">
      <div className="pw-reading-head">
        <button className="btn btn-ghost btn-xs" onClick={onBack}>
          ← Conversations
        </button>
        <span className="pw-convo-title">{conversation.title}</span>
        <span className="grill-strip-spacer" />
        <Button disabled={reopening || !conversation.resumable} onClick={onReopen}>
          {reopening ? 'Opening…' : 'Reopen'}
        </Button>
      </div>
      <ConversationTranscript sessionId={conversation.id} />
    </div>
  )
}
