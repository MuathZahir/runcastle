import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import type { ProjectConversation } from '../lib/api'
import { PROJECT_BRANCH } from '../lib/project-workspace'
import type { ProjectTalkApi, ProjectTalkPurpose } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { IconArrowRight, IconBranch, IconFolder, IconMessage, IconPanelRight } from '../icons'
import { useLivePoll } from '../lib/live'
import { IconButton, Page, PageHeader, PageTopbar } from '../ui'
import { projectChatEntries, scenarioChatLabel, type ChatSessionEntry } from '../lib/chat-sessions'
import { projectViewLabel, projectViews, type PanelView } from '../lib/feature-ui/panel'
import { ScenarioChatContext, ScenarioChatView, useScenarioChat } from './chat/ScenarioChat'
import { SessionSwitcher } from './chat/SessionSwitcher'
import { ConversationList } from './project/ConversationList'
import { NewChatCard } from './project/NewChatCard'
import { NotesCard } from './project/NotesCard'
import { ProjectChat } from './project/ProjectChat'
import { ProjectDriveView } from './project/ProjectDriveView'
import { TestDriveCard } from './project/TestDriveCard'
import { FeaturePanel, PanelButtons, PanelSplit, PanelStrip, usePanel } from './workspace/FeaturePanel'
import { projectDriveCard } from '../lib/project-drive'
import { scenarioMenu } from '../lib/feature-ui/scenarios'
import { useProjectDrive } from '../lib/use-project-drive'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in,
 * the one surface in the shell bound to a project rather than a feature: the
 * project's CONVERSATIONS, and the door to a new one.
 *
 * Chat-first, in the feature page's own pieces (design-mode decision 11): the
 * chat column on the left, and on its right one resizable panel holding the
 * project drive or the Notes inbox (the project page's details).
 *
 * The column at rest is three pieces and nothing else (decisions.md #6): a
 * header naming the branch this chat runs on and the branch its work lands on,
 * the two doors (New chat — the page's one primary — and Test drive) as quiet
 * rows, and the list of chats. The chat's own greeting says what it knows; the
 * landing branch lives in a menu beside the button it argues (decisions.md #3).
 *
 * A list, not a terminal, is the resting state (decision 5). Only one chat runs
 * at a time — the launcher's rule — so a live conversation fills the column,
 * and its switcher lists the past ones, each opening its read-only transcript;
 * the project crumb steps back to the list.
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
  /** The titlebar's drive pill asked for the project drive. */
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
  // What a project drive can land on (drive-scenarios decision 7): every
  // scenario at the checked-out HEAD. A project with no dev command drives a
  // bare checkout with no URL to land on, so it offers none.
  const scenariosQ = trpc.feature.driveScenarios.useQuery({ projectId })
  const startScenarios = scenarioMenu(scenariosQ.data?.scenarios ?? [], {
    withOwnSection: false,
    runnerConfigured: (scenariosQ.data?.runnerConfigured ?? false) && !!project?.devCommand?.trim(),
  })
  const session = talk.session
  // What is in front of the chat column: `undefined` follows the live chat (the
  // resting list when there is none), `null` is the list, an id is that entry.
  const [front, setFront] = useState<string | null | undefined>(session && newChatRequest > 0 ? null : undefined)
  // The same key the Notes card reads, so knowing whether to offer it is free.
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const [showOpenNotice, setShowOpenNotice] = useState(Boolean(session && newChatRequest > 0))
  // What the pending open/replace choice is FOR. A Triage click on a project
  // that already has a chat open raises the same notice New chat does, and
  // "End it and start new" has to open the chat the human asked for.
  const [noticePurpose, setNoticePurpose] = useState<ProjectTalkPurpose | undefined>(undefined)
  // The drive's scenario errands open their chat in this column too.
  const scenarioChat = useScenarioChat(drive?.scenarioSessionId, setFront)

  const entries: ChatSessionEntry[] = [
    ...projectChatEntries({ liveId: session?.id ?? null, conversations: talk.conversations }),
    ...(scenarioChat.listed && scenarioChat.sessionId
      ? [{ id: scenarioChat.sessionId, label: scenarioChatLabel(scenarioChat.errand), live: true }]
      : []),
  ]
  const fallback = session?.id ?? null
  const inFront =
    front === undefined ? fallback : front === null ? null : entries.some((e) => e.id === front) ? front : fallback
  const reading =
    inFront && inFront !== session?.id && inFront !== scenarioChat.sessionId
      ? (talk.conversations.find((c) => c.id === inFront) ?? null)
      : null
  const resting = inFront === null

  const projectName = project?.name ?? 'This project'
  const openNotes = (notesQ.data ?? []).filter((n) => n.status === 'open').length
  const hasNotes = (notesQ.data ?? []).length > 0

  // The panel: the views this page offers, and the one open. Untouched, the
  // Notes inbox is open beside the resting list while something waits in it;
  // the human's own toggle wins from then on.
  const views = projectViews({ driveActive: !!drive, hasNotes })
  const [picked, setPicked] = useState<PanelView | null | undefined>(undefined)
  const wanted = picked === undefined ? (resting && openNotes > 0 ? 'details' : null) : picked
  const panel = usePanel(wanted && views.includes(wanted) ? wanted : null, (v) => setPicked(v === 'chat' ? null : v))
  const shown = panel.state.view
  const openView = (view: PanelView) => panel.dispatch({ type: 'open', view, origin: 'human' })
  const toggleView = (view: PanelView) => panel.dispatch(shown === view ? { type: 'close' } : { type: 'open', view, origin: 'human' })

  useEffect(() => {
    if (newChatRequest > 0 && session) {
      setFront(null)
      setShowOpenNotice(true)
      setNoticePurpose(undefined)
      onConsumeNewChatRequest?.()
    }
  }, [newChatRequest, onConsumeNewChatRequest, session])
  // Capture's View: the inbox is the panel's Notes; the card scrolls itself in.
  useEffect(() => {
    if (inboxRequest > 0) setPicked('details')
  }, [inboxRequest])
  useEffect(() => {
    if (!session) {
      setShowOpenNotice(false)
      setNoticePurpose(undefined)
    }
  }, [session])
  // The titlebar's pill: the drive, from wherever in the project.
  useEffect(() => {
    if (driveRequest > 0) {
      setPicked('drive')
      onConsumeDriveRequest?.()
    }
  }, [driveRequest, onConsumeDriveRequest])

  const driveCard = projectDriveCard({
    // Nothing to say until the row answers, rather than a
    // "Prepare drive" that flickers into "Test drive".
    empty: empty || !project,
    setupCommand: project?.driveSetupCommand,
    devCommand: project?.devCommand,
    drive: projectDrive.slot,
    projectId,
  })
  // The live chat in front of the column.
  const showChat = (): void => setFront(undefined)
  // Reopening leaves the read-back chat behind: what comes back is the terminal.
  const reopen = (sessionId: string): void => {
    talk.resume(sessionId)
    showChat()
  }

  const chatHidden = !!shown && !panel.state.collapsed && panel.state.share >= 1
  const switcher = inFront && <SessionSwitcher entries={entries} current={inFront} onPick={setFront} />
  const inFrontLabel = entries.find((e) => e.id === inFront)?.label

  const restPage = (
    <div className={resting && !chatHidden ? 'flex min-h-0 flex-1 flex-col' : 'hidden'} hidden={!resting || chatHidden}>
      <Page routeKey={`project-${projectId}`}>
        <PageHeader
          title={projectName}
          meta={[
            { icon: <IconBranch />, text: PROJECT_BRANCH, mono: true, title: 'the branch project chats run on' },
            landing.value ? { icon: <IconArrowRight />, text: `lands on ${landing.value}` } : null,
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
            card={driveCard}
            branch={drive?.branch ?? (branchesQ.data?.current || null)}
            setupCommand={project?.driveSetupCommand}
            devCommand={project?.devCommand}
            stopCommand={project?.driveStopCommand}
            starting={projectDrive.starting}
            scenarios={startScenarios}
            // The human's Test drive: the drive it started opens in the panel.
            onStart={(scenario) => projectDrive.start(scenario, () => panel.dispatch({ type: 'follow', click: 'testDrive' }))}
            onPrepare={() => onOpenPreparation?.()}
            onReturn={() => openView('drive')}
          />
        </div>
        <ConversationList
          conversations={talk.conversations}
          pending={talk.conversationsPending}
          busy={talk.starting}
          onResume={reopen}
          onOpen={showChat}
          // The live conversation is the one live chat, so reading it
          // is opening it; only an ended one is read back.
          onView={(c: ProjectConversation) => (c.status === 'ended' ? setFront(c.id) : showChat())}
        />
      </Page>
    </div>
  )

  const panelView = (view: PanelView) => {
    switch (view) {
      case 'drive':
        return drive ? (
          <ProjectDriveView
            projectId={projectId}
            repoPath={project?.repoPath}
            drive={drive}
            // Stop lands on the Notes inbox, where the drive's notes are
            // waiting. No summary, no prompt: the inbox is the exit.
            onStop={() =>
              projectDrive.stop(() => panel.dispatch(hasNotes ? { type: 'switch', view: 'details' } : { type: 'close' }))
            }
            stopping={projectDrive.stopping}
            onOpenPreparation={() => onOpenPreparation?.()}
          />
        ) : null
      case 'details':
        return (
          <div className="px-6 py-5">
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
                setFront(null)
              }}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, ...(resting ? {} : { onClick: () => setFront(null) }) },
          ...(inFrontLabel && !resting ? [{ label: inFrontLabel, icon: <IconMessage /> }] : []),
        ]}
        actions={
          <>
            <PanelButtons views={views} open={shown} label={projectViewLabel} onToggle={toggleView} />
            {hasNotes && (
              <IconButton
                label="Notes"
                badge={openNotes}
                icon={<IconPanelRight />}
                active={shown === 'details'}
                onClick={() => toggleView('details')}
              />
            )}
          </>
        }
      />
      {/* The drive's errands open their chat in this page's column. */}
      <ScenarioChatContext.Provider value={scenarioChat}>
        <PanelSplit
          chat={
            // Every live terminal stays mounted whatever is in front, so
            // xterm keeps its buffer and socket.
            <>
              {restPage}
              {reading && (
                // An ended chat is the project chat at rest — the same ChatView
                // a feature's ended chat shows, never a page of its own.
                <ProjectChat
                  key={reading.id}
                  session={null}
                  transcriptId={reading.id}
                  onResume={reading.resumable ? () => reopen(reading.id) : undefined}
                  resuming={talk.starting}
                  branch={landing.value}
                  hidden={chatHidden}
                  switcher={switcher}
                />
              )}
              {session && (
                <ProjectChat
                  session={session}
                  branch={landing.value}
                  hidden={chatHidden || inFront !== session.id}
                  switcher={switcher}
                  onEnded={() => {
                    void utils.project.projectSession.invalidate()
                    void utils.project.conversations.invalidate()
                  }}
                />
              )}
              <ScenarioChatView
                chat={scenarioChat}
                switcher={switcher}
                hidden={chatHidden || inFront !== scenarioChat.sessionId}
              />
            </>
          }
          panel={
            shown && (
              <FeaturePanel
                view={shown}
                views={views}
                label={projectViewLabel}
                onSwitch={(view) => panel.dispatch({ type: 'switch', view })}
                onCollapse={() => panel.dispatch({ type: 'collapse' })}
                onClose={() => panel.dispatch({ type: 'close' })}
              >
                {panelView(shown)}
              </FeaturePanel>
            )
          }
          share={panel.state.share}
          collapsed={panel.state.collapsed}
          strip={
            shown && (
              <PanelStrip
                label={projectViewLabel(shown)}
                onExpand={() => panel.dispatch({ type: 'expand' })}
                onClose={() => panel.dispatch({ type: 'close' })}
              />
            )
          }
          onResize={(share) => panel.dispatch({ type: 'setWidth', share })}
          onToggleFull={() => panel.dispatch({ type: 'toggleFull' })}
        />
      </ScenarioChatContext.Provider>
    </section>
  )
}
