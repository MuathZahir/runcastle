import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { rememberedView, useWorkspace, type DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { useProjectTalk } from '../lib/use-project-talk'
import { useLivePoll } from '../lib/live'
import { isNoteHotkey } from '../lib/project-notes'
import { isThisProjectDrive } from '../lib/project-drive'
import { workspaceView } from '../lib/project-workspace'
import { landingFeature } from '../lib/feature-ui'
import {
  insideProject,
  addressedView,
  featureViewOf,
  locationFor,
  parsePath,
  projectIdOf,
  type AppLocation,
  type FeatureView,
} from '../lib/routes'
import { AddressSettled, currentPath, useHistorySync } from '../lib/use-history-sync'
import { LandOnChatProvider, landingView } from '../lib/land-on-chat'
import { SidebarThreadsProvider } from '../lib/sidebar-threads'
import type { FeatureListItem, PrepView } from '../lib/api'
import { Sidebar } from './Sidebar'
import { Frame, useFrame } from './Frame'
import { FeatureCrash, Workspace } from './Workspace'
import { ErrorBoundary } from './ErrorBoundary'
import { ProjectWorkspace } from './ProjectWorkspace'
import { QuickForm } from './QuickForm'
import { PreparationWorkspace } from './PreparationWorkspace'
import { CommandPalette } from './CommandPalette'
import { NoteCapture } from './NoteCapture'
import { OpenSettingsProvider } from './settings/MessageWithSettingsLink'
import { SettingsDialog } from './settings/SettingsDialog'

/**
 * The runcastle IDE shell for a single project (app-redesign, multi-project #45).
 * The frame (DESIGN.md §Frame): the project sidebar on the canvas, and the
 * content panel holding one view — the selected feature (with its details
 * panel), the project home, preparation or the draft form. ⌘K opens the
 * command palette, ⌘B collapses the sidebar. Everything here is scoped to `projectId`; the outer
 * shell picks which project (or the portfolio home) is showing. The active test
 * drive (at most one globally) is shell state, shared by the workspace and status
 * bar.
 *
 * It also owns the in-project half of the URL (decision 1) — the feature, the
 * chat and preparation — because it is the only place that can resolve a
 * feature slug to the id the state machine selects by.
 */
export function ProjectShell({ projectId, nav }: { projectId: string; nav: ProjectNavApi }) {
  const ws = useWorkspace(projectId)
  const {
    selectedFeatureId,
    projectSelected,
    preparing,
    select,
    selectView,
    selectProject,
    startPreparation,
    setCmdk,
  } = ws
  const [driving, setDriving] = useState<DriveState | null>(null)
  const [newChatRequest, setNewChatRequest] = useState(0)
  // Note capture is shell state for one reason: it is mounted HERE, so it exists
  // on every in-project screen and on none of the portfolio home (decisions #2).
  // All three doors onto it — the titlebar button, the hotkey and the palette
  // row — set the same flag (decisions #3).
  // Each press is also counted, so one landing while the bar is already up still
  // reaches it — over the saved line it starts the next note.
  const [capturing, setCapturing] = useState(false)
  const [jots, setJots] = useState(0)
  const jot = () => {
    setCapturing(true)
    setJots((n) => n + 1)
  }
  // The saved line's View: the project workspace, with its Notes card brought
  // into view — selecting the workspace alone does nothing visible from the
  // workspace itself, or with the card scrolled off (decisions #16).
  const [inboxRequest, setInboxRequest] = useState(0)
  const openInbox = () => {
    selectProject()
    setInboxRequest((request) => request + 1)
  }
  const consumeInboxRequest = () => setInboxRequest(0)
  // The titlebar's drive pill: the project workspace, with its live project
  // drive brought to the front (project-level-test-drive decision 4).
  const [driveRequest, setDriveRequest] = useState(0)
  const openDrive = () => {
    selectProject()
    setDriveRequest((request) => request + 1)
  }
  const consumeDriveRequest = () => setDriveRequest(0)
  // The frame's sidebar state is app-wide (Frame.tsx); the palette toggles it.
  const frame = useFrame()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The project conversation, polled once here and read by the pinned rail row,
  // the project workspace and both "talk it through" doors.
  const talk = useProjectTalk(projectId)
  // Assumed prepared until it answers, so a fresh project's home never flashes
  // through the call-to-action on its way to the real one.
  const prep = trpc.project.prep.useQuery({ projectId }) as { data?: PrepView }
  const prepared = prep.data?.prepared ?? true
  const empty = prep.data?.empty ?? true
  // The one drive query every drive surface polls, read for the titlebar pill.
  const slot = trpc.feature.driveInfo.useQuery({ projectId }, { refetchInterval: useLivePoll() }).data
  const projectDrive = isThisProjectDrive(slot, projectId) ? slot : null

  const features = list.data

  /**
   * Open a feature on `view`, or — when nothing names one (the rail, the
   * palette, a link that only says "this feature") — on the view it was left
   * on, else the chat alone (one-chat-layout-everywhere decision 8,
   * design-mode decision 5). `null` is the project home.
   */
  const openFeature = useCallback(
    (featureId: string | null, view?: FeatureView) => {
      if (!featureId) return select(null)
      select(featureId, view ?? rememberedView(featureId, features?.find((f) => f.id === featureId)))
    },
    [select, features],
  )

  // Every session launch under this shell lands on its feature's chat. On the
  // feature already on screen the open panel stays (the launch changes only the
  // chat column); anywhere else it is the chat alone — a view switch like any
  // other, so it is remembered and Back undoes it. A draft's body is its page,
  // not a panel, so a draft's Start lands on the chat alone.
  const shownView = ws.featureView
  const landOnChat = useCallback(
    (featureId: string) => {
      const onScreen =
        selectedFeatureId &&
        !projectSelected &&
        !preparing &&
        features?.find((f) => f.id === selectedFeatureId)?.status !== 'draft'
      select(featureId, landingView(featureId, { featureId: onScreen ? selectedFeatureId : null, view: shownView }))
    },
    [select, selectedFeatureId, projectSelected, preparing, features, shownView],
  )

  /**
   * Where to land, once and only once, when the feature list first arrives
   * (decision 1 + decision 4). Three sources in order: the address bar, then
   * what this project stored, then the rail's own triage order — the rule that
   * replaced `list.data[0]`, which was newest-created and lane-blind and so
   * opened parked drafts and shipped retrospectives (findings F10.4).
   *
   * A slug in the URL that no longer names a feature falls through to the same
   * triage rule rather than to the stored selection: the address was explicit,
   * so silently restoring some unrelated feature would be the wrong repair.
   */
  const [landed, setLanded] = useState(false)
  const [urlAtMount] = useState(() => parsePath(currentPath()))
  useEffect(() => {
    if (landed || !features) return
    const addressed = insideProject(urlAtMount, projectId)

    if (addressed?.kind === 'chat') selectProject()
    else if (addressed?.kind === 'prepare') startPreparation()
    else if (addressed) {
      // A view in the address wins, Work included when the address names it; a
      // bare feature path restores the remembered one — which, after a reload,
      // is the view the path was showing anyway.
      const named = features.find((f) => f.slug === addressed.featureSlug)
      if (named) openFeature(named.id, addressedView(addressed))
      else openFeature(landingFeature(features)?.id ?? null)
    } else if (!selectedFeatureId && !projectSelected && !preparing) {
      const target = landingFeature(features)
      if (target) openFeature(target.id)
    } else if (selectedFeatureId && !projectSelected && !preparing) {
      // The restored selection: settle the storage guess now the list can say
      // whether a session is live.
      selectView(rememberedView(selectedFeatureId, features.find((f) => f.id === selectedFeatureId)))
    }
    setLanded(true)
  }, [
    landed,
    features,
    projectId,
    urlAtMount,
    selectedFeatureId,
    projectSelected,
    preparing,
    openFeature,
    selectView,
    selectProject,
    startPreparation,
  ])

  // The address this shell is showing, and the setters a Back or Forward drives.
  //
  // Null in the two windows where the shell has no address to state: before the
  // landing above has run (an address written then would be corrected a render
  // later, leaving a stray entry behind), and while the Draft form owns the body
  // — an overlay is not a place, and opening it clears the pinned project row
  // and any open preparation underneath it (decision 1).
  // The selected feature, read once: the URL wants its slug, the titlebar's
  // third breadcrumb level wants its title (decision 11).
  const selectedFeature = features?.find((f) => f.id === selectedFeatureId)
  const selectedSlug = selectedFeature?.slug ?? null
  // A draft has no chat and no panel (decision 11): its body is the page, at the bare address.
  const featureView = selectedFeature?.status === 'draft' ? 'work' : ws.featureView
  const location: AppLocation | null =
    landed && !ws.creating
      ? locationFor({ projectId, preparing, projectSelected, featureSlug: selectedSlug, featureView })
      : null

  useHistorySync(location, (popped) => {
    // A pop that changed project — or left for the portfolio home — is the outer
    // nav's to handle: it remounts this shell, which reads the popped URL
    // through the landing above.
    if (!popped || projectIdOf(popped) !== projectId) return
    const inside = insideProject(popped, projectId)
    if (!inside) select(null) // a bare `/p/<id>`: the project home
    else if (inside.kind === 'chat') selectProject()
    else if (inside.kind === 'prepare') startPreparation()
    else {
      // The popped path says exactly which view — a bare one is Work, not
      // "whatever was remembered", or Back from a tab could never reach it.
      const named = features?.find((f) => f.slug === inside.featureSlug)
      if (named) select(named.id, featureViewOf(inside))
      else openFeature(landingFeature(features ?? [])?.id ?? null)
    }
  })

  // The New door (decisions.md #12): open the project workspace on a FRESH
  // conversation — an empty thread its first message starts, as the New chat
  // card opens one, whatever else is running (chat-as-web-components decision 14).
  const newChat = () => {
    selectProject()
    setNewChatRequest((request) => request + 1)
  }

  // Global ⌘K / Ctrl-K → command palette, ⌘/Ctrl+J → jot a note.
  //
  // The note chord has to fire with the focus inside an embedded terminal, which
  // is where most of the time is spent — xterm would otherwise send Ctrl+J's LF
  // to the PTY and cancel the event. `mapTerminalKey` swallows it there without
  // cancelling, which is what lets it reach this listener (lib/terminal-keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdk(true)
      } else if (isNoteHotkey(e)) {
        e.preventDefault()
        jot()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCmdk])

  const view = workspaceView({ ...ws, featureCount: features?.length ?? 0, prepared, empty })
  // The details are one of the feature page's panel views (design-mode
  // decision 5), so the palette's toggle and the page's button are one switch.
  const detailsToggle =
    view === 'feature' ? () => ws.selectView(featureView === 'details' ? 'chat' : 'details') : undefined

  const body =
    view === 'create' ? (
      <section className="relative flex min-h-0 min-w-0 flex-col">
        <QuickForm projectId={projectId} onCancel={ws.cancelCreate} onCreated={openFeature} />
      </section>
    ) : view === 'prepare' ? (
      // `onClose` only when there is somewhere to go back to: the automatic
      // call-to-action IS the project home, so a Back button there would
      // dead-end on the screen it just left.
      <PreparationWorkspace
        projectId={projectId}
        {...(ws.preparing ? { onClose: ws.closePreparation } : {})}
      />
    ) : view === 'project' ? (
      <ProjectWorkspace
        projectId={projectId}
        talk={talk}
        newChatRequest={newChatRequest}
        onConsumeNewChatRequest={() => setNewChatRequest(0)}
        inboxRequest={inboxRequest}
        onConsumeInboxRequest={consumeInboxRequest}
        empty={empty}
        onOpenPreparation={ws.startPreparation}
        driveRequest={driveRequest}
        onConsumeDriveRequest={consumeDriveRequest}
      />
    ) : view === 'feature' && selectedFeatureId ? (
      // The feature view is the app's one unbounded render surface — it
      // renders whatever a feature's row, tickets and sessions say. Contain it
      // (findings F19): a crash in here keeps the sidebar, the other features
      // and every other project alive. Keyed by feature so selecting a
      // different one resets the boundary instead of leaving the crash face up.
      <ErrorBoundary
        key={`ws-${selectedFeatureId}`}
        label="feature view"
        fallback={(error) => <FeatureCrash featureId={selectedFeatureId} error={error} />}
      >
        <Workspace
          featureId={selectedFeatureId}
          view={featureView}
          onViewChange={ws.selectView}
          guidance={ws.guidance}
          driving={driving}
          onDriveChange={setDriving}
          // Same exit as the sidebar's delete: drop the stale selection, land
          // on the project home.
          onDeleted={() => {
            ws.select(null)
            ws.selectProject()
          }}
        />
      </ErrorBoundary>
    ) : null

  const shell = (
    <>
      <Frame
        sidebar={
          <Sidebar
            projectId={projectId}
            nav={nav}
            view={view}
            selectedFeatureId={ws.selectedFeatureId}
            onSelect={openFeature}
            onSelectProject={ws.selectProject}
            onNewChat={newChat}
            onDraft={ws.startDraft}
            onOpenPreparation={ws.startPreparation}
            onOpenNote={jot}
            onOpenCmdk={() => setCmdk(true)}
            onOpenSettings={() => ws.openSettings()}
            projectDriveBranch={projectDrive?.branch ?? null}
            onOpenProjectDrive={openDrive}
            driving={driving}
            onDriveChange={setDriving}
          />
        }
      >
        {/* The view fills the panel. The feature's details are not mounted
            here: they are one of the feature page's panel views, and the
            palette's toggle switches the same `featureView` the page does. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
          {/* Until the landing, the page shown is the stored one, not the
              address's: it leaves the address's thread for the page it names. */}
          <AddressSettled.Provider value={landed}>{body}</AddressSettled.Provider>
        </div>
      </Frame>

      <CommandPalette
        open={ws.cmdkOpen}
        onClose={() => ws.setCmdk(false)}
        features={features ?? []}
        selectedFeatureId={ws.selectedFeatureId}
        onSelect={openFeature}
        onOpenSettings={() => ws.openSettings()}
        onOpenPreparation={ws.startPreparation}
        // The palette navigates, it never launches: this opens the project
        // home, where the conversation list decides new-versus-resume.
        onOpenProjectChat={ws.selectProject}
        onOpenNote={jot}
        onToggleSidebar={frame.toggleSidebar}
        onToggleDetails={detailsToggle}
        nav={nav}
      />

      {/* Mounted by the in-project shell, so capture is on every screen inside a
          project and on none of the portfolio home (decisions #2). */}
      <NoteCapture
        projectId={projectId}
        projectName={nav.currentProject?.name ?? ''}
        open={capturing}
        openRequest={jots}
        onClose={() => setCapturing(false)}
        onOpenInbox={openInbox}
      />

      {ws.settings && (
        <SettingsDialog
          projectId={projectId}
          projectName={nav.currentProject?.name ?? ''}
          location={ws.settings}
          onClose={ws.closeSettings}
        />
      )}
    </>
  )

  // Anything under the shell — a ticket's error, a burn lane — can turn a
  // "Settings → Workers" pointer into a link that lands on the row it names.
  // And any session launch under it lands on that feature's chat.
  return (
    <OpenSettingsProvider open={ws.openSettings}>
      <LandOnChatProvider value={landOnChat}>
        {/* The open page publishes its threads; the sidebar beside it lists them. */}
        <SidebarThreadsProvider>{shell}</SidebarThreadsProvider>
      </LandOnChatProvider>
    </OpenSettingsProvider>
  )
}

