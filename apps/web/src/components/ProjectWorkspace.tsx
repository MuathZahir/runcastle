import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { PROJECT_BRANCH } from '../lib/project-workspace'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { IconArrowRight, IconBranch, IconFolder, IconPlay } from '../icons'
import { useLivePoll } from '../lib/live'
import { Button, Page, PageHeader, PageTopbar } from '../ui'
import { NEW_CHAT_NAME, scenarioChatLabel, standIn, withStandIns } from '../lib/chat-sessions'
import { useToast } from '../lib/toast'
import { usePublishSidebarThreads } from '../lib/sidebar-threads'
import { useAddressedThread, useThreadInUrl } from '../lib/use-history-sync'
import { projectViewLabel, projectViews, type PanelView } from '../lib/feature-ui/panel'
import { ScenarioChatContext, scenarioErrandHint, useScenarioChat } from './chat/ScenarioChat'
import { ThreadColumn, ThreadOpening } from './chat/ThreadColumn'
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
 * fills the column as a thread (chat-as-web-components decision 7); every chat
 * of the project lists in the sidebar under the Orchestrator (threads-in-the-sidebar), and the project
 * crumb steps back to the list. Any number of chats run at once (decision 14).
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
  // What is in front of the chat column: `undefined` follows the newest running
  // chat (the resting list when none runs), `null` is the list, an id is that thread.
  // Every chat of the project, finished ones included (chat-as-web-components
  // decision 7) — the resting list and the switcher both read it, so both show
  // the same names and states (decision 14). Invalidated by every `thread`
  // live signal (lib/live.ts).
  const listQ = trpc.thread.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const listed = listQ.data ?? []
  const fallback = talk.session?.id ?? null
  // A reload or a pasted link opens the chat the address names — when it is this project's.
  const {
    front,
    pick: setFront,
    pending,
  } = useAddressedThread<null | undefined>(
    undefined,
    listQ.data
      ? (id) => id === fallback || id === drive?.scenarioSessionId || listed.some((t) => t.id === id)
      : null,
  )
  // The same key the Notes card reads, so knowing whether to offer it is free.
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The drive's scenario errands open their chat in this column too.
  const scenarioChat = useScenarioChat(drive?.scenarioSessionId, setFront)
  const toast = useToast()

  const closedErrand = !!front && front === scenarioChat.sessionId && !scenarioChat.listed
  // While the address's chat is pending, nothing is in front and the list is not shown either.
  const opening = pending !== null
  const inFront = opening ? null : front === undefined || closedErrand ? fallback : front
  useThreadInUrl(opening ? undefined : inFront)
  const resting = inFront === null && !opening
  // The sidebar and the header always name what is in front, before the list has it.
  const threads = withStandIns(
    listed,
    inFront
      ? [
          inFront === scenarioChat.sessionId
            ? standIn(inFront, scenarioChatLabel(scenarioChat.errand), 'scenario')
            : standIn(inFront, NEW_CHAT_NAME, 'project'),
        ]
      : [],
  )
  const runtimeOf = (id: string) => threads.find((t) => t.id === id)?.runtime
  // Every new-chat door — New chat, the shell's New, the sidebar's "+" —
  // opens an empty thread, whatever else is running (decision 14); its first
  // message starts it.
  const create = trpc.thread.new.useMutation({
    onSuccess: ({ threadId }) => {
      setFront(threadId)
      void utils.thread.list.invalidate({ projectId })
    },
    onError: (e) => toast.push(e.message),
  })
  const newChat = (): void => create.mutate({ projectId })
  const newChatRef = useRef(newChat)
  newChatRef.current = newChat

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
    newChatRef.current()
    onConsumeNewChatRequest?.()
  }, [newChatRequest, onConsumeNewChatRequest])
  // Capture's View: the inbox is the panel's Notes; the card scrolls itself in.
  useEffect(() => {
    if (inboxRequest > 0) setPicked('details')
  }, [inboxRequest])
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

  const chatHidden = !!shown && !panel.state.collapsed && panel.state.share >= 1
  const scenarioInFront = !!scenarioChat.sessionId && inFront === scenarioChat.sessionId
  // The Orchestrator's chats live in the sidebar, under its card
  // (threads-in-the-sidebar); its "All N conversations" is this page at rest.
  usePublishSidebarThreads({
    scope: { projectId },
    threads,
    current: inFront,
    pick: setFront,
    newThread: newChat,
    ...(scenarioChat.sessionId && scenarioChat.listed
      ? { errand: { threadId: scenarioChat.sessionId, close: scenarioChat.close } }
      : {}),
    rest: () => setFront(null),
  })
  const inFrontTitle = inFront ? threads.find((t) => t.id === inFront)?.title : undefined

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
          <NewChatCard landing={landing} onStart={newChat} starting={create.isPending} />
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
        <ConversationList threads={listed} pending={listQ.isPending} onOpen={setFront} />
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
              triaging={talk.triaging}
              reveal={inboxRequest > 0}
              onRevealed={onConsumeInboxRequest}
              // Its own new thread, beside any chat already running (decision 14).
              onTriage={() => talk.triage(setFront)}
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
          chat in front named as plain text (threads-in-the-sidebar decision 6);
          at most one action; the panel toggle. */}
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, ...(resting ? {} : { onClick: () => setFront(null) }) },
          ...(inFrontTitle && !resting ? [{ label: inFrontTitle }] : []),
        ]}
        trail
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
              {opening && !chatHidden && <ThreadOpening />}
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
                    key={inFront}
                    threadId={inFront}
                    {...(runtimeOf(inFront) ? { runtime: runtimeOf(inFront) } : {})}
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
