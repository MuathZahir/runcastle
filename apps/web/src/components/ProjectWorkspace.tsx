import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import type { ProjectConversation } from '../lib/api'
import { PROJECT_BRANCH } from '../lib/project-workspace'
import type { ProjectTalkApi, ProjectTalkPurpose } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { IconArrowRight, IconBranch, IconFolder, IconPanelRight } from '../icons'
import { useLivePoll } from '../lib/live'
import { Aside, Button, IconButton, Page, PageHeader, PageTopbar, StatusDot } from '../ui'
import { ConversationTranscript } from './ConversationTranscript'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'
import { ConversationList } from './project/ConversationList'
import { NewChatCard } from './project/NewChatCard'
import { NotesCard } from './project/NotesCard'
import { TranscriptPane } from './project/TranscriptPane'
import { LiveChat } from './project/LiveChat'
import { ChatDriveSwitch, ProjectDriveView } from './project/ProjectDriveView'
import { TestDriveCard } from './project/TestDriveCard'
import { projectDriveCard } from '../lib/project-drive'
import { useProjectDrive } from '../lib/use-project-drive'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in.
 *
 * This is the one surface in the shell bound to a project rather than a feature:
 * the project's CONVERSATIONS, and the door to a new one.
 *
 * At rest it is three pieces and nothing else (decisions.md #6): a header
 * naming the branch this chat runs on and the branch its work lands on, the two
 * doors (New chat — the page's one primary — and Test drive) as quiet rows, and
 * the list of chats — plus the Notes inbox as the page's one aside, on the
 * projects that have jotted one. It used to carry a paragraph on every card —
 * what the chat already knows, what the landing branch means, why changing it
 * would not affect the chat already running — which is first-use explanation
 * charged to every visit. The chat's own greeting says what it knows; the
 * landing branch moved into a menu beside the button it argues (decisions.md
 * #3), which is what retired the grey note apologising for it.
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
  inboxRequest = 0,
  onConsumeInboxRequest,
  empty = false,
  onOpenPreparation,
  driveRequest = 0,
  onConsumeDriveRequest,
}: {
  projectId: string
  talk: ProjectTalkApi
  newChatRequest?: number
  onConsumeNewChatRequest?: () => void
  /** Capture's View asked for the Notes inbox (decisions #16). */
  inboxRequest?: number
  onConsumeInboxRequest?: () => void
  /** Born-empty: nothing to drive, so no Test drive card (drive decision 7). */
  empty?: boolean
  /** Open the preparation workspace — where drive commands are established. */
  onOpenPreparation?: () => void
  /** The titlebar's drive pill asked for the live project drive. */
  driveRequest?: number
  onConsumeDriveRequest?: () => void
}) {
  const utils = trpc.useUtils()
  // Same query key the nav already polls, so this costs no extra fetch.
  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)
  const landing = useSessionBranch(projectId)
  // The same key the landing menu reads, so the checkout's branch is free.
  const branchesQ = trpc.project.branches.useQuery({ projectId, includeFeatureBranches: true })
  const projectDrive = useProjectDrive(projectId)
  const drive = projectDrive.drive
  const session = talk.session
  const [viewing, setViewing] = useState<ProjectConversation | null>(null)
  // The same key the Notes aside reads, so knowing whether to offer it is free.
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The Notes aside: `null` until the human toggles it (then it follows them).
  const [notesOpen, setNotesOpen] = useState<boolean | null>(null)
  // Keep the terminal mounted behind the list so xterm retains its client-side
  // buffer and socket; `TerminalView` tears both down when it unmounts.
  const [showList, setShowList] = useState(Boolean(session && newChatRequest > 0))
  // A live chat and a live drive coexist (drive decision 4); this is which of
  // the two fills the body when both could.
  const [front, setFront] = useState<'chat' | 'drive'>('chat')
  const [showOpenNotice, setShowOpenNotice] = useState(Boolean(session && newChatRequest > 0))
  // What the pending open/replace choice is FOR. A Triage click on a project
  // that already has a chat open raises the same notice New chat does, and
  // "End it and start new" has to open the chat the human asked for.
  const [noticePurpose, setNoticePurpose] = useState<ProjectTalkPurpose | undefined>(undefined)
  useEffect(() => {
    if (newChatRequest > 0 && session) {
      setShowList(true)
      setShowOpenNotice(true)
      setNoticePurpose(undefined)
      onConsumeNewChatRequest?.()
    }
  }, [newChatRequest, onConsumeNewChatRequest, session])
  // The inbox sits on the resting page, so asking for it steps out of a live
  // chat or a read transcript first; the card scrolls itself in once shown.
  useEffect(() => {
    if (inboxRequest > 0) {
      setViewing(null)
      setShowList(true)
      setNotesOpen(true)
    }
  }, [inboxRequest])
  useEffect(() => {
    if (!session) {
      setShowOpenNotice(false)
      setNoticePurpose(undefined)
    }
  }, [session])
  // A chat that opens is what the human just asked for, so it comes to the front
  // of a drive that shares the body.
  const sessionId = session?.id
  useEffect(() => {
    if (sessionId) setFront('chat')
  }, [sessionId])
  const showDrive = (): void => {
    setViewing(null)
    setShowList(false)
    setFront('drive')
  }
  const showChat = (): void => {
    setShowList(false)
    setFront('chat')
  }
  // Out of the drive to the resting page. `showList` is only the chat's step
  // back: with no chat, a drive out of the front already leaves the page at rest,
  // and setting it would keep the next chat opened from taking the body.
  const toRestingPage = (): void => {
    setFront('chat')
    if (session) setShowList(true)
  }
  // The titlebar's pill: back to the drive from wherever in the project.
  useEffect(() => {
    if (driveRequest > 0) {
      showDrive()
      onConsumeDriveRequest?.()
    }
  }, [driveRequest, onConsumeDriveRequest])

  const reading = viewing
  // What fills the body. The resting page, unless a live chat or a live drive
  // has been brought to the front; with both live, `front` picks between them.
  const resting = reading !== null || showList || (!session && !(drive && front === 'drive'))
  const driveInFront = Boolean(drive) && !resting && (front === 'drive' || !session)
  const chatInFront = Boolean(session) && !resting && !driveInFront
  const switcher =
    session && drive ? (
      <ChatDriveSwitch front={driveInFront ? 'drive' : 'chat'} onPick={setFront} />
    ) : undefined
  // Reopening leaves the read-only pane behind: what comes back is the terminal,
  // and closing that should land on the list, not on the transcript of the
  // conversation you have just been having.
  const reopen = (sessionId: string): void => {
    talk.resume(sessionId)
    setViewing(null)
    showChat()
  }

  const projectName = project?.name ?? 'This project'
  const openNotes = (notesQ.data ?? []).filter((n) => n.status === 'open').length
  const hasNotes = (notesQ.data ?? []).length > 0
  // Open by default while something is waiting in the inbox; the human's own
  // toggle wins from then on.
  const notesShown = hasNotes && (notesOpen ?? openNotes > 0)

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className={resting ? 'flex min-h-0 flex-1 flex-col' : 'hidden'} hidden={!resting}>
        {reading ? (
          <TranscriptPane
            conversation={reading}
            projectName={projectName}
            onBack={() => setViewing(null)}
            onReopen={() => {
              if (reading.status === 'ended') reopen(reading.id)
              else {
                setViewing(null)
                showChat()
              }
            }}
            reopening={talk.starting}
          >
            <ConversationTranscript sessionId={reading.id} />
          </TranscriptPane>
        ) : (
          <>
            <PageTopbar
              crumbs={[{ label: projectName, icon: <IconFolder /> }]}
              actions={
                <>
                  {session && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<StatusDot tone="live" />}
                      onClick={showChat}
                    >
                      Live chat
                    </Button>
                  )}
                  {hasNotes && (
                    <IconButton
                      label={openNotes > 0 ? `Notes · ${openNotes} open` : 'Notes'}
                      icon={<IconPanelRight />}
                      active={notesShown}
                      onClick={() => setNotesOpen(!notesShown)}
                    />
                  )}
                </>
              }
            />
            <div className="flex min-h-0 flex-1">
              <Page routeKey={`project-${projectId}`}>
                <PageHeader
                  title={projectName}
                  meta={[
                    { icon: <IconBranch />, text: PROJECT_BRANCH, mono: true, title: 'the branch project chats run on' },
                    { icon: <IconArrowRight />, text: `lands on ${landing.value ?? '…'}` },
                  ]}
                />
                <div className="mt-8">
                  <NewChatCard
                    landing={landing}
                    onStart={talk.start}
                    starting={talk.starting}
                    openSession={
                      session && showOpenNotice
                        ? {
                            onOpen: () => {
                              setShowOpenNotice(false)
                              setNoticePurpose(undefined)
                              showChat()
                            },
                            onReplace: () => {
                              setShowOpenNotice(false)
                              talk.replace(noticePurpose)
                              showChat()
                            },
                          }
                        : undefined
                    }
                  />
                  <TestDriveCard
                    card={projectDriveCard({
                      // Nothing to say until the row answers, rather than a
                      // "Prepare drive" that flickers into "Test drive".
                      empty: empty || !project,
                      setupCommand: project?.driveSetupCommand,
                      devCommand: project?.devCommand,
                      drive: projectDrive.slot,
                      projectId,
                    })}
                    branch={drive?.branch ?? (branchesQ.data?.current || null)}
                    setupCommand={project?.driveSetupCommand}
                    devCommand={project?.devCommand}
                    stopCommand={project?.driveStopCommand}
                    starting={projectDrive.starting}
                    onStart={() => projectDrive.start(showDrive)}
                    onPrepare={() => onOpenPreparation?.()}
                    onReturn={showDrive}
                  />
                </div>
                <ConversationList
                  conversations={talk.conversations}
                  pending={talk.conversationsPending}
                  busy={talk.starting}
                  onResume={reopen}
                  onOpen={showChat}
                  onView={setViewing}
                />
              </Page>
              {/* The inbox is the page's one aside (decisions.md #10): read on
                  the way to triaging it, and triage starts from it. */}
              {notesShown && (
                <Aside title="Notes" onClose={() => setNotesOpen(false)}>
                  <NotesCard
                    projectId={projectId}
                    triaging={talk.starting}
                    reveal={inboxRequest > 0}
                    onRevealed={onConsumeInboxRequest}
                    onTriage={() => {
                      if (!session) {
                        talk.triage()
                        return
                      }
                      // One live chat per project, so the human chooses: carry on
                      // in the one that is open, or end it and triage in a fresh one.
                      setNoticePurpose('triage')
                      setShowOpenNotice(true)
                    }}
                  />
                </Aside>
              )}
            </div>
          </>
        )}
      </div>
      {drive && (
        <ProjectDriveView
          projectId={projectId}
          projectName={projectName}
          repoPath={project?.repoPath}
          drive={drive}
          hidden={!driveInFront}
          onProjectPage={toRestingPage}
          // Stop lands on the resting page, where the drive's notes are waiting
          // in the Notes aside. No summary, no prompt: the inbox is the exit.
          onStop={() => projectDrive.stop(toRestingPage)}
          stopping={projectDrive.stopping}
          onOpenPreparation={() => onOpenPreparation?.()}
          switcher={switcher}
        />
      )}
      {session && (
        <LiveChat
          session={session}
          projectName={projectName}
          title={titleFor(talk.conversations, session.id) ?? 'project'}
          branch={landing.value}
          hidden={!chatInFront}
          switcher={switcher}
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
