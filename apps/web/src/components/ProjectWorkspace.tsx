import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { useSessionBranch } from '../lib/use-session-branch'
import { IconOrchestrator } from '../icons'
import { useLivePoll } from '../lib/live'
import { PageTopbar } from '../ui'
import { backInApp } from '../lib/use-history-sync'
import { NEW_CHAT_NAME, UNSTARTED_CHAT, scenarioChatLabel, standIn, withStandIns } from '../lib/chat-sessions'
import { useToast } from '../lib/toast'
import { orchestratorLanding, usePublishSidebarThreads } from '../lib/sidebar-threads'
import { useAddressedThread, useThreadInUrl } from '../lib/use-history-sync'
import { projectViewLabel, panelTabs, projectViews, type PanelView } from '../lib/feature-ui/panel'
import { ScenarioChatContext, scenarioErrandHint, useScenarioChat } from './chat/ScenarioChat'
import { ThreadColumn, ThreadOpening } from './chat/ThreadColumn'
import { ConversationsPage } from './project/ConversationsPage'
import { NotesCard } from './project/NotesCard'
import { ProjectChat } from './project/ProjectChat'
import { ProjectDriveButton } from './project/ProjectDriveButton'
import { ProjectDriveView } from './project/ProjectDriveView'
import { StartTheProject } from './project/StartTheProject'
import { FeaturePanel, PanelSplit, PanelStrip, PanelToggle, usePanel } from './workspace/FeaturePanel'
import { projectDriveCard } from '../lib/project-drive'
import { scenarioMenu } from '../lib/feature-ui/scenarios'
import { useProjectDrive, type SlotDrive } from '../lib/use-project-drive'
import { useIsPhone } from '../lib/use-phone'
import { PhoneChatBar } from './phone/PhoneChatBar'
import { threadPhoneStatus } from './phone/phone-views'

/**
 * The Orchestrator: what the sidebar's card opens, the one surface in the shell
 * bound to a project rather than a feature. Like a feature, it is its chat
 * (the-orchestrator-s-page): it opens on the active chat that moved last, on the
 * Conversations page when none is active, or on Start the project when the
 * project has none, with one resizable panel on the right holding the project drive or the
 * Notes inbox. The active chats list in the sidebar, and all of them on the
 * Conversations page. Any number of chats run at once (decision 14).
 */

export function ProjectWorkspace({
  projectId,
  talk,
  newChatRequest = 0,
  onConsumeNewChatRequest,
  inboxRequest = 0,
  onConsumeInboxRequest,
  empty = false,
  repoKnown = true,
  conversations = false,
  threadRequest = null,
  onConsumeThreadRequest,
  onOpenConversations,
  onCloseConversations,
  driveRequest = 0,
  onConsumeDriveRequest,
  onBackToList,
}: {
  projectId: string
  talk: ProjectTalkApi
  newChatRequest?: number
  onConsumeNewChatRequest?: () => void
  /** Capture's View asked for the Notes inbox (decisions #16). */
  inboxRequest?: number
  onConsumeInboxRequest?: () => void
  /** Born-empty: nothing to drive, so no Test drive (drive decision 7). */
  empty?: boolean
  /** Whether `empty` has been answered yet: the Start card waits for it rather than guess. */
  repoKnown?: boolean
  /** The Conversations page is open instead of a chat. */
  conversations?: boolean
  /** A chat to open on arrival: a feature's page asked for its holder. */
  threadRequest?: string | null
  onConsumeThreadRequest?: () => void
  onOpenConversations?: () => void
  /** Back to the chats, from the Conversations page. */
  onCloseConversations?: () => void
  /** The titlebar's drive pill asked for the project drive. */
  driveRequest?: number
  onConsumeDriveRequest?: () => void
  /** On a phone, the chat bar's Back: the list. */
  onBackToList?: () => void
}) {
  const phone = useIsPhone()
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
  // Every chat of the project, finished ones included (chat-as-web-components
  // decision 7) — the sidebar and the Conversations page both read it, so both show
  // the same names and states (decision 14). Invalidated by every `thread`
  // live signal (lib/live.ts).
  const listQ = trpc.thread.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const listed = listQ.data ?? []
  // Same key the sidebar polls: a chat holding features counts as active.
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const fallback = talk.session?.id ?? null
  // A reload or a pasted link opens the chat the address names — when it is this project's.
  const {
    front,
    pick: setFront,
    pending,
  } = useAddressedThread<undefined>(
    undefined,
    listQ.data
      ? (id) => id === fallback || id === drive?.scenarioSessionId || listed.some((t) => t.id === id)
      : null,
  )
  // The same key the Notes card reads, so knowing whether to offer it is free.
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The drive's scenario errands open their chat in this column too.
  const scenarioChat = useScenarioChat(drive?.scenarioSessionId, (id) => open(id))
  const toast = useToast()

  const closedErrand = !!front && front === scenarioChat.sessionId && !scenarioChat.listed
  // While the address's chat is pending, nothing is in front.
  const opening = pending !== null
  // With no active chat the page lists them all, at this address: nothing to
  // push, so Back does not land here again. Latched, as the pick below is.
  const [listing, setListing] = useState(false)
  // Arriving, or an errand's chat closing, lands once: a chat in front stays
  // there while others post, and so does the list while a chat turns active.
  const landingOnLatest =
    !opening &&
    !threadRequest &&
    !listing &&
    !!listQ.data &&
    (featuresQ.data !== undefined || featuresQ.isError) &&
    (front === undefined || closedErrand)
  const landed = landingOnLatest ? orchestratorLanding(listed, featuresQ.data ?? [], Date.now()) : null
  const latest = landed?.kind === 'chat' ? landed.threadId : landed?.kind === 'none' ? fallback : null
  if (landingOnLatest && (latest !== null || closedErrand)) setFront(latest ?? undefined)
  if (landed?.kind === 'conversations') setListing(true)
  const inFront = opening || closedErrand ? null : (front ?? null)
  // A project with no chats opens on Start the project.
  const unstarted = landed?.kind === 'none' && !latest
  const allChats = conversations || listing
  const inView = allChats ? null : inFront
  useThreadInUrl(opening ? undefined : inView)
  // The sidebar and the header always name what is in front, before the list has it.
  const threads = withStandIns(
    listed,
    inFront
      ? [
          inFront === scenarioChat.sessionId
            ? standIn(inFront, scenarioChatLabel(scenarioChat.errand), 'scenario')
            : standIn(inFront, NEW_CHAT_NAME, 'project'),
        ]
      : unstarted
        ? [standIn(UNSTARTED_CHAT, NEW_CHAT_NAME, 'project')]
        : [],
  )
  // A pick from anywhere leaves the Conversations page for that chat.
  const open = (threadId: string): void => {
    setFront(threadId)
    setListing(false)
    if (conversations) onCloseConversations?.()
  }
  const runtimeOf = (id: string) => threads.find((t) => t.id === id)?.runtime
  // Every new-chat door — New chat, the shell's New, the sidebar's "+" —
  // opens an empty thread, whatever else is running (decision 14); its first
  // message starts it.
  const create = trpc.thread.new.useMutation({
    onSuccess: ({ threadId }) => {
      open(threadId)
      void utils.thread.list.invalidate({ projectId })
    },
    onError: (e) => toast.push(e.message),
  })
  const newChat = (): void => create.mutate({ projectId })
  // The doors where the Orchestrator speaks first — Start the project, and the
  // drive's "set it up" doors that used to open Preparation
  // (the-orchestrator-prepares-the-project decisions 1, 6): a fresh chat
  // launched with its kickoff and no message from the human.
  const launch = trpc.project.talkToProject.useMutation({
    onSuccess: ({ sessionId }) => {
      open(sessionId)
      // Asked from the drive's page: back to the chat, the drive still running.
      if (panel.state.view === 'drive') panel.dispatch({ type: 'close' })
      void utils.thread.list.invalidate({ projectId })
    },
    onError: (e) => toast.push(e.message),
  })
  const askOrchestrator = (): void => {
    if (!launch.isPending) launch.mutate({ projectId, fresh: true })
  }
  // The header's Set up drives: an Orchestrator chat already at work (most
  // likely the one preparing this project) is where that happens, so it opens
  // that chat rather than starting a second one beside it.
  const setUpDrives = (): void => {
    const live = listed
      .filter((t) => t.role === 'project' && t.state !== 'idle')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (live) open(live.id)
    else askOrchestrator()
  }
  const newChatRef = useRef(newChat)
  newChatRef.current = newChat

  const openNotes = (notesQ.data ?? []).filter((n) => n.status === 'open').length
  const hasNotes = (notesQ.data ?? []).length > 0

  // The panel: the views this page offers, and the one open. It opens when asked.
  const views = projectViews({ driveActive: !!drive || projectDrive.starting, hasNotes })
  const [picked, setPicked] = useState<PanelView | null>(null)
  const panel = usePanel(picked && views.includes(picked) ? picked : null, (v) => setPicked(v === 'chat' ? null : v))
  const tabs = panelTabs(views)
  const shown = panel.state.view
  const openView = (view: PanelView) => panel.dispatch({ type: 'open', view, origin: 'human' })

  useEffect(() => {
    if (newChatRequest <= 0) return
    newChatRef.current()
    onConsumeNewChatRequest?.()
  }, [newChatRequest, onConsumeNewChatRequest])
  useEffect(() => {
    if (!threadRequest) return
    setFront(threadRequest)
    setListing(false)
    onConsumeThreadRequest?.()
  }, [threadRequest, onConsumeThreadRequest, setFront])
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
  // The human's Test drive: the click is the drive's page at once.
  const startDrive = (scenario: string | null = null): void => {
    panel.dispatch({ type: 'follow', click: 'testDrive' })
    projectDrive.start(scenario, () => panel.dispatch({ type: 'close' }))
  }

  // A phone shows the chat alone: the drive and the Notes inbox are the computer's.
  const chatHidden = !phone && !!shown && !panel.state.collapsed && panel.state.share >= 1
  // The drive stays mounted while it runs, so the app is as it was left on the
  // way back (test-drive-looks-the-part decision 13).
  const onDrive = shown === 'drive' && !phone
  const shownDrive: SlotDrive | null = phone
    ? null
    : (drive ??
      (projectDrive.starting
        ? ({ state: 'idle', branch: branchesQ.data?.current ?? '', holderLabel: '', devReady: false, devConfigured: true } as SlotDrive)
        : null))
  const scenarioInFront = !!scenarioChat.sessionId && inFront === scenarioChat.sessionId
  // The Orchestrator's chats live in the sidebar, under its card
  // (threads-in-the-sidebar); its "All N conversations" is the Conversations page.
  usePublishSidebarThreads({
    scope: { projectId },
    threads,
    current: allChats ? null : (inFront ?? (unstarted ? UNSTARTED_CHAT : null)),
    pick: (id) => {
      if (id !== UNSTARTED_CHAT) open(id)
      else if (conversations) onCloseConversations?.()
    },
    newThread: newChat,
    ...(scenarioChat.sessionId && scenarioChat.listed
      ? { errand: { threadId: scenarioChat.sessionId, close: scenarioChat.close } }
      : {}),
    ...(onOpenConversations ? { allConversations: onOpenConversations } : {}),
  })
  // An unstarted project's one action is its Start button: the header names nothing more.
  const inFrontTitle = inFront ? threads.find((t) => t.id === inFront)?.title : undefined

  const panelView = (view: PanelView) => {
    switch (view) {
      case 'details':
        return (
          <div className="px-6 py-5">
            <NotesCard
              projectId={projectId}
              triaging={talk.triaging}
              reveal={inboxRequest > 0}
              onRevealed={onConsumeInboxRequest}
              // Its own new thread, beside any chat already running (decision 14).
              onTriage={() => talk.triage(open)}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {shownDrive && (
        <ScenarioChatContext.Provider value={scenarioChat}>
          <ProjectDriveView
            projectId={projectId}
            repoPath={project?.repoPath}
            drive={shownDrive}
            hidden={!onDrive}
            onBack={() => panel.dispatch({ type: 'close' })}
            // Stop lands on the Notes inbox, where the drive's notes are
            // waiting. No summary, no prompt: the inbox is the exit.
            onStop={() =>
              projectDrive.stop(() => panel.dispatch(hasNotes ? { type: 'switch', view: 'details' } : { type: 'close' }))
            }
            // Stop waits for the start: a second mutate would drop the first's callbacks.
            stopping={projectDrive.stopping || projectDrive.starting}
            onAskOrchestrator={askOrchestrator}
          />
        </ScenarioChatContext.Provider>
      )}
      <div className={onDrive ? 'hidden' : 'flex min-h-0 min-w-0 flex-1 flex-col'}>
      {/* The one header row (design-mode decision 12): the Orchestrator, then
          the chat in front named as plain text (threads-in-the-sidebar decision
          6); at most one action; the panel toggle. */}
      {phone ? (
        <PhoneChatBar
          title="Orchestrator"
          status={threadPhoneStatus(threads.find((t) => t.id === inFront)?.state)}
          onBack={() => backInApp(() => onBackToList?.())}
        />
      ) : (
      <PageTopbar
        crumbs={[
          {
            label: 'Orchestrator',
            icon: <IconOrchestrator size={14} />,
            ...(allChats
              ? {
                  onClick: () => {
                    setListing(false)
                    onCloseConversations?.()
                  },
                }
              : {}),
          },
          ...(allChats ? [{ label: 'Chats' }] : inFrontTitle ? [{ label: inFrontTitle }] : []),
        ]}
        trail
        actions={
          <>
            {!unstarted && <ProjectDriveButton
              card={driveCard}
              starting={projectDrive.starting}
              scenarios={startScenarios}
              onStart={startDrive}
              onSetUp={setUpDrives}
              onReturn={() => openView('drive')}
            />}
            <PanelToggle
              open={!!shown}
              views={tabs}
              badge={openNotes}
              onToggle={() => panel.dispatch({ type: 'toggle', views: tabs })}
            />
          </>
        }
      />
      )}
      {/* The drive's errands open their chat in this page's column. */}
      <ScenarioChatContext.Provider value={scenarioChat}>
        <PanelSplit
          chat={
            // One thread in front, or the Conversations page.
            <>
              {allChats && !chatHidden && <ConversationsPage threads={listed} pending={listQ.isPending} onOpen={open} />}
              {!allChats && opening && !chatHidden && <ThreadOpening />}
              {!allChats && inFront && !chatHidden &&
                (scenarioInFront ? (
                  <ThreadColumn
                    key={inFront}
                    label="Scenario chat"
                    threadId={inFront}
                    onOpenThread={open}
                    emptyHint={scenarioErrandHint(scenarioChat.errand)}
                  />
                ) : (
                  <ProjectChat
                    key={inFront}
                    threadId={inFront}
                    {...(runtimeOf(inFront) ? { runtime: runtimeOf(inFront) } : {})}
                    onOpenThread={open}
                    landing={landing}
                  />
                ))}
              {/* A project with no chats yet opens on its one button
                  (the-orchestrator-prepares-the-project decision 1): the
                  Orchestrator's first chat starts on the click and speaks first. */}
              {!allChats && unstarted && !chatHidden && repoKnown && !!project && (
                <StartTheProject
                  name={project?.name ?? ''}
                  {...(project?.repoPath ? { repoPath: project.repoPath } : {})}
                  empty={empty}
                  starting={launch.isPending}
                  onStart={askOrchestrator}
                />
              )}
            </>
          }
          panel={
            shown &&
            shown !== 'drive' &&
            !phone && (
              <FeaturePanel
                view={shown}
                views={tabs}
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
      </div>
    </section>
  )
}
