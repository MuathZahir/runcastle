import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import type { ProjectConversation } from '../lib/api'
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
import { LiveChat } from './project/LiveChat'

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
  newChatRequest = 0,
  onConsumeNewChatRequest,
}: {
  projectId: string
  talk: ProjectTalkApi
  newChatRequest?: number
  onConsumeNewChatRequest?: () => void
}) {
  const utils = trpc.useUtils()
  // Same query key the nav already polls, so this costs no extra fetch.
  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)
  const landing = useSessionBranch(projectId)
  const session = talk.session
  const [viewing, setViewing] = useState<ProjectConversation | null>(null)
  // Keep the terminal mounted behind the list so xterm retains its client-side
  // buffer and socket; `TerminalView` tears both down when it unmounts.
  const [showList, setShowList] = useState(Boolean(session && newChatRequest > 0))
  const [showOpenNotice, setShowOpenNotice] = useState(Boolean(session && newChatRequest > 0))
  useEffect(() => {
    if (newChatRequest > 0 && session) {
      setShowList(true)
      setShowOpenNotice(true)
      onConsumeNewChatRequest?.()
    }
  }, [newChatRequest, onConsumeNewChatRequest, session])
  useEffect(() => {
    if (!session) setShowOpenNotice(false)
  }, [session])
  const reading = viewing
  // Reopening leaves the read-only pane behind: what comes back is the terminal,
  // and closing that should land on the list, not on the transcript of the
  // conversation you have just been having.
  const reopen = (sessionId: string): void => {
    talk.resume(sessionId)
    setViewing(null)
    setShowList(false)
  }

  return (
    <section className="workspace">
      {/* The page's own rail, on the rhythm of decisions.md #9 — 8px inside the
          header, 24px between the body's cards, 32px from header to body. The
          width and gutter are the shell's, so swapping to this page does not
          shift the column the feature workspace beside it uses. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto pt-6 pb-8"
        hidden={Boolean(session && !showList && !reading)}
      >
        <div className="mx-auto flex w-full max-w-[calc(var(--content-max)+56px)] flex-col gap-8 px-7">
          <header className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-pill border border-accent-line bg-accent-soft px-2 py-0.5 text-xs font-semibold tracking-[0.1em] text-accent-hi uppercase">
                Project
              </span>
              <h1 className="text-xl leading-tight font-semibold tracking-[-0.01em] text-text">
                {project?.name ?? 'This project'}
              </h1>
            </div>
            <p className="text-sm text-text-3">
              Chats run on <code className="font-mono text-text-2">{PROJECT_BRANCH}</code> and land
              on <code className="font-mono text-text-2">{landing.value ?? '…'}</code>.
            </p>
          </header>

          {reading ? (
            <TranscriptPane
              conversation={reading}
              onBack={() => setViewing(null)}
              onReopen={() => {
                if (reading.status === 'ended') reopen(reading.id)
                else {
                  setViewing(null)
                  setShowList(false)
                }
              }}
              reopening={talk.starting}
            >
              <ConversationTranscript sessionId={reading.id} />
            </TranscriptPane>
          ) : !session || showList ? (
            <div className="flex flex-col gap-6">
              <NewChatCard
                landing={landing}
                onStart={talk.start}
                starting={talk.starting}
                openSession={
                  session && showOpenNotice
                    ? {
                        onOpen: () => {
                          setShowOpenNotice(false)
                          setShowList(false)
                        },
                        onReplace: () => {
                          setShowOpenNotice(false)
                          talk.replace()
                          setShowList(false)
                        },
                      }
                    : undefined
                }
              />
              <ConversationList
                conversations={talk.conversations}
                pending={talk.conversationsPending}
                busy={talk.starting}
                onResume={reopen}
                onOpen={() => setShowList(false)}
                onView={setViewing}
              />
            </div>
          ) : null}
        </div>
      </div>
      {session && (
        <LiveChat
          session={session}
          title={titleFor(talk.conversations, session.id) ?? 'project'}
          branch={landing.value}
          hidden={showList || reading !== null}
          onBack={() => {
            setShowOpenNotice(false)
            setShowList(true)
          }}
          endControl={
            <EndSessionButton
              sessionId={session.id}
              onEnded={() => {
                void utils.project.projectSession.invalidate()
                void utils.project.conversations.invalidate()
              }}
            />
          }
        >
          <ErrorBoundary label="terminal">
            <TerminalView sessionId={session.id} />
          </ErrorBoundary>
        </LiveChat>
      )}
    </section>
  )
}

/** The conversation's name, once the list knows it. */
function titleFor(conversations: ProjectConversation[], sessionId: string): string | null {
  return conversations.find((c) => c.id === sessionId)?.title ?? null
}
