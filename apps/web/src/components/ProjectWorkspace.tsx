import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import type { ProjectConversation } from '../lib/api'
import { PROJECT_BRANCH } from '../lib/project-workspace'
import type { ProjectTalkApi, ProjectTalkPurpose } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { IconArrowRight, IconBranch, IconFolder, IconPlay } from '../icons'
import { useLivePoll } from '../lib/live'
import { Button, Page, PageHeader, PageTopbar } from '../ui'
import { scenarioChatLabel, standIn, withStandIns } from '../lib/chat-sessions'
import { conversationTitle } from '../lib/conversation-title'
import { useToast } from '../lib/toast'
import { projectViewLabel, projectViews, type PanelView } from '../lib/feature-ui/panel'
import { ScenarioChatContext, ScenarioChatMenu, scenarioErrandHint, useScenarioChat } from './chat/ScenarioChat'
import { ThreadColumn } from './chat/ThreadColumn'
import { ThreadSwitcher } from './chat/thread/ThreadSwitcher'
import { ConversationList } from './project/ConversationList'
import { NewChatCard } from './project/NewChatCard'
import { NotesCard } from './project/NotesCard'
import { ProjectChat } from './project/ProjectChat'
import { ProjectDriveView } from './project/ProjectDriveView'
import { TestDriveCard } from './project/TestDriveCard'
import { FeaturePanel, PanelSplit, PanelStrip, PanelToggle, usePanel } from './workspace/FeaturePanel'
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
 * A list, not a thread, is the resting state (decision 5). A chat in front
 * fills the column as a thread (chat-as-web-components decision 7), and its
 * switcher lists every chat of the project, each opening at once; the project
 * crumb steps back to the list.
 */

/** What is in front for a new chat that has not been started: an empty thread. */
const NEW_CHAT = 'new-chat'

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
  const toast = useToast()
  // The thread a new chat became on its first message.
  const [begun, setBegun] = useState<string | null>(null)

  // Every chat of the project, finished ones included (chat-as-web-components
  // decision 7); invalidated by every `thread` live signal (lib/live.ts).
  const listed = trpc.thread.list.useQuery({ projectId }, { refetchInterval: useLivePoll() }).data ?? []
  const fallback = session?.id ?? null
  const closedErrand = !!front && front === scenarioChat.sessionId && !scenarioChat.listed
  const inFront = front === undefined || closedErrand ? fallback : front
  const resting = inFront === null
  // The switcher always names what is in front, before the list has it.
  const threads = withStandIns(
    listed,
    inFront
      ? [
          inFront === NEW_CHAT
            ? standIn(NEW_CHAT, 'New chat', 'project')
            : inFront === scenarioChat.sessionId
              ? standIn(inFront, scenarioChatLabel(scenarioChat.errand), 'scenario')
              : standIn(inFront, conversationTitle(talk.conversations.find((c) => c.id === inFront)?.title), 'project'),
        ]
      : [],
  )
  const runtimeOf = (id: string) => threads.find((t) => t.id === id)?.runtime
  const create = trpc.thread.new.useMutation({
    onSuccess: ({ threadId }) => {
      setFront(threadId)
      void utils.thread.list.invalidate({ projectId })
    },
    onError: (e) => toast.push(e.message),
  })

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

  useEffect(() => {
    if (newChatRequest <= 0) return
    if (session) {
      setFront(null)
      setShowOpenNotice(true)
      setNoticePurpose(undefined)
    } else {
      // With none open, a new chat is an empty thread its first message starts.
      setFront(NEW_CHAT)
    }
    onConsumeNewChatRequest?.()
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
  // The human's Test drive: the drive it started opens in the panel. The topbar
  // starts the blank app, as the card's main click does.
  const startDrive = (scenario: string | null = null): void =>
    projectDrive.start(scenario, () => panel.dispatch({ type: 'follow', click: 'testDrive' }))
  // The live chat in front of the column.
  const showChat = (): void => setFront(undefined)

  const chatHidden = !!shown && !panel.state.collapsed && panel.state.share >= 1
  // The switcher's menu speaks for the chat in front: the scenario chat's close.
  const scenarioInFront = !!scenarioChat.sessionId && inFront === scenarioChat.sessionId
  const switcher = inFront && (
    <ThreadSwitcher threads={threads} current={inFront} onPick={setFront} onNew={() => create.mutate({ projectId })}>
      {scenarioInFront && <ScenarioChatMenu chat={scenarioChat} />}
    </ThreadSwitcher>
  )

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
            // With none open, a new chat is an empty thread its first message starts.
            onStart={session ? talk.start : () => setFront(NEW_CHAT)}
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
            onStart={startDrive}
            onPrepare={() => onOpenPreparation?.()}
            onReturn={() => openView('drive')}
          />
        </div>
        <ConversationList
          conversations={talk.conversations}
          pending={talk.conversationsPending}
          busy={talk.starting}
          // Every chat opens as its thread at once; a message picks a finished one back up.
          onOpen={setFront}
          onView={(c: ProjectConversation) => setFront(c.id)}
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
      {/* The one header row (design-mode decision 12): the project, then the
          switcher naming the chat in front as the crumb after it; at most one
          action; the panel toggle. */}
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, ...(resting ? {} : { onClick: () => setFront(null) }) },
          ...(switcher && !resting ? [{ label: switcher }] : []),
        ]}
        actions={
          <>
            {/* The resting page's Test drive card is behind a live chat, so the
                topbar carries its start until a drive is up — then the panel
                toggle is the way to it. */}
            {!resting && (driveCard.state === 'ready' || driveCard.state === 'blocked') && (
              <Button
                size="sm"
                variant="ghost"
                icon={<IconPlay />}
                className="mr-1"
                loading={projectDrive.starting}
                disabled={driveCard.state === 'blocked' || projectDrive.starting}
                title={driveCard.state === 'blocked' ? driveCard.reason : undefined}
                onClick={() => startDrive()}
              >
                Test drive
              </Button>
            )}
            <PanelToggle
              open={!!shown}
              views={views}
              badge={openNotes}
              onToggle={() => panel.dispatch({ type: 'toggle', views })}
            />
          </>
        }
      />
      {/* The drive's errands open their chat in this page's column. */}
      <ScenarioChatContext.Provider value={scenarioChat}>
        <PanelSplit
          chat={
            // One thread in front, or the resting list; the switcher picks.
            <>
              {restPage}
              {inFront && !chatHidden &&
                (scenarioInFront ? (
                  <ThreadColumn
                    key={inFront}
                    label="Scenario chat"
                    threadId={inFront}
                    onOpenThread={setFront}
                    emptyHint={scenarioErrandHint(scenarioChat.errand)}
                  />
                ) : (
                  <ProjectChat
                    // A new chat keeps one column through its start, so its
                    // first message stays on screen while the chat takes its id.
                    key={inFront === NEW_CHAT || inFront === begun ? NEW_CHAT : inFront}
                    projectId={projectId}
                    threadId={inFront === NEW_CHAT ? null : inFront}
                    {...(runtimeOf(inFront) ? { runtime: runtimeOf(inFront) } : {})}
                    start={talk.begin}
                    onStarted={(threadId) => {
                      setBegun(threadId)
                      setFront(threadId)
                      void utils.thread.list.invalidate({ projectId })
                    }}
                    onOpenThread={setFront}
                    {...(landing.value ? { landing: landing.value } : {})}
                  />
                ))}
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
