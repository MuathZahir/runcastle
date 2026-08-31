import { useState } from 'react'
import { trpc } from '../trpc'
import { SessionStatusDot } from '../ui'
import type { ProjectConversation } from '../lib/api'
import { sessionStatusLabel } from '../lib/feature-ui'
import { PROJECT_BRANCH } from '../lib/project-workspace'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { ConversationTranscript } from './ConversationTranscript'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'
import { ConversationList } from './project/ConversationList'
import { NewChatCard } from './project/NewChatCard'
import { TranscriptPane } from './project/TranscriptPane'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in.
 *
 * This is the one surface in the shell bound to a project rather than a feature:
 * the project's CONVERSATIONS, and the door to a new one.
 *
 * At rest it is three pieces and nothing else (decisions.md #6): a header line
 * naming the branch this chat runs on and the branch its work lands on, the New
 * chat card, and the list. It used to carry a paragraph on every card — what the
 * chat already knows, what the landing branch means, why changing it would not
 * affect the chat already running — which is first-use explanation charged to
 * every visit. The chat's own greeting says what it knows; the landing branch
 * moved into a menu beside the button it argues (decisions.md #3), which is what
 * retired the grey note apologising for it.
 *
 * A list, not a terminal, is the resting state (decision 5). Only one chat runs
 * at a time — the launcher's rule — so a live conversation takes the body over,
 * exactly as the single session used to.
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
  const landing = useSessionBranch(projectId)
  const session = talk.session
  // The conversation being read back, if any. A live session outranks it — the
  // terminal owns the body, whoever opened it and from wherever.
  const [viewing, setViewing] = useState<ProjectConversation | null>(null)
  const reading = session ? null : viewing
  // Reopening leaves the read-only pane behind: what comes back is the terminal,
  // and closing that should land on the list, not on the transcript of the
  // conversation you have just been having.
  const reopen = (sessionId: string): void => {
    talk.resume(sessionId)
    setViewing(null)
  }

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-pill border border-accent-line bg-accent-soft px-2 py-0.5 text-xs font-semibold tracking-[0.1em] text-accent-hi uppercase">
              Project
            </span>
            <h1 className="text-xl leading-tight font-semibold tracking-[-0.01em] text-text">
              {project?.name ?? 'This project'}
            </h1>
          </div>
          <p className="text-sm text-text-3">
            Chats run on <code className="font-mono text-text-2">{PROJECT_BRANCH}</code> and land on{' '}
            <code className="font-mono text-text-2">{landing.value ?? '…'}</code>.
          </p>
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-body-inner">
          {session ? (
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
          ) : reading ? (
            <TranscriptPane
              conversation={reading}
              onBack={() => setViewing(null)}
              onReopen={() => reopen(reading.id)}
              reopening={talk.starting}
            >
              <ConversationTranscript sessionId={reading.id} />
            </TranscriptPane>
          ) : (
            <div className="flex flex-col gap-6">
              <NewChatCard landing={landing} onStart={talk.start} starting={talk.starting} />
              <ConversationList
                conversations={talk.conversations}
                pending={talk.conversationsPending}
                busy={talk.starting}
                onResume={reopen}
                onView={setViewing}
              />
            </div>
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
