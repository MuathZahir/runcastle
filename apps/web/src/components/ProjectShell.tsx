import { useEffect, useState } from 'react'
import { LogoMark } from '../icons'
import { trpc } from '../trpc'
import { useWorkspace, type DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { useProjectTalk } from '../lib/use-project-talk'
import { useLivePoll } from '../lib/live'
import { showsInspector, workspaceView } from '../lib/project-workspace'
import type { PrepView } from '../lib/api'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { FeatureCrash, Workspace } from './Workspace'
import { ErrorBoundary } from './ErrorBoundary'
import { ProjectWorkspace } from './ProjectWorkspace'
import { QuickForm } from './QuickForm'
import { PreparationWorkspace } from './PreparationWorkspace'
import { CommandPalette } from './CommandPalette'
import { OpenSettingsProvider } from './settings/MessageWithSettingsLink'
import { SettingsDialog } from './settings/SettingsDialog'

/**
 * The runcastle IDE shell for a single project (app-redesign, multi-project #45).
 * A title bar, a triage features rail, a single workspace bound to the selected
 * feature (or the new-feature form), the inspector rail, and a status bar. ⌘K
 * opens the command palette. Everything here is scoped to `projectId`; the outer
 * shell picks which project (or the portfolio home) is showing. The active test
 * drive (at most one globally) is shell state, shared by the workspace and status
 * bar.
 */
export function ProjectShell({ projectId, nav }: { projectId: string; nav: ProjectNavApi }) {
  const ws = useWorkspace(projectId)
  const { selectedFeatureId, projectSelected, select, selectProject, setCmdk } = ws
  const [driving, setDriving] = useState<DriveState | null>(null)
  const [newChatRequest, setNewChatRequest] = useState(0)
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The project conversation, polled once here and read by the pinned rail row,
  // the project workspace and both "talk it through" doors.
  const talk = useProjectTalk(projectId)
  // Assumed prepared until it answers, so a fresh project's home never flashes
  // through the call-to-action on its way to the real one.
  const prep = trpc.project.prep.useQuery({ projectId }) as { data?: PrepView }
  const prepared = prep.data?.prepared ?? true

  // Land on a feature: select the first one once, if nothing is selected yet.
  // Never over the project workspace — `select` would swap it back out.
  useEffect(() => {
    if (!selectedFeatureId && !projectSelected && list.data && list.data.length > 0)
      select(list.data[0].id)
  }, [selectedFeatureId, projectSelected, list.data, select])

  // The New door (decisions.md #12): open the project workspace and start a
  // FRESH conversation in it — intake for anything that deserves talking about.
  // `talk.start` is the new-chat contract, so a live conversation is left alone
  // and the workspace's list is what you land on instead.
  const newChat = () => {
    selectProject()
    if (talk.session) setNewChatRequest((request) => request + 1)
    else talk.start()
  }

  // Global ⌘K / Ctrl-K → command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdk(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCmdk])

  const view = workspaceView({ ...ws, featureCount: list.data?.length ?? 0, prepared })
  const showInspector = showsInspector(view, ws.inspectorCollapsed)

  const shell = (
    <div className={`shell${ws.inspectorCollapsed ? ' inspector-collapsed' : ''}`}>
      <Titlebar
        nav={nav}
        onOpenCmdk={() => ws.setCmdk(true)}
        onOpenSettings={() => ws.openSettings()}
        onToggleInspector={ws.toggleInspector}
        inspectorCollapsed={ws.inspectorCollapsed}
      />

      <div className="shell-body">
        <Sidebar
          projectId={projectId}
          selectedFeatureId={ws.selectedFeatureId}
          projectSelected={ws.projectSelected}
          talk={talk}
          onSelect={ws.select}
          onSelectProject={ws.selectProject}
          onNewChat={newChat}
          onQuickChange={ws.startQuickChange}
          onOpenPreparation={ws.startPreparation}
        />

        {view === 'create' ? (
          <section className="workspace">
            <QuickForm projectId={projectId} onCancel={ws.cancelCreate} onCreated={ws.select} />
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
          />
        ) : view === 'feature' && selectedFeatureId ? (
          // The feature view is the app's one unbounded render surface — it
          // renders whatever a feature's row, tickets and sessions say. Contain
          // it (findings F19): a crash in here keeps the rail, the other
          // features and every other project alive. Keyed by feature so
          // selecting a different one resets the boundary instead of leaving
          // the crash face up.
          <ErrorBoundary
            key={`ws-${selectedFeatureId}`}
            label="feature view"
            fallback={(error) => <FeatureCrash featureId={selectedFeatureId} error={error} />}
          >
            <Workspace
              featureId={selectedFeatureId}
              viewedPhase={ws.viewedPhase}
              onViewPhase={ws.viewPhase}
              guidance={ws.guidance}
              mapRailCollapsed={ws.mapRailCollapsed}
              onToggleMapRail={ws.toggleMapRail}
              driving={driving}
              onDriveChange={setDriving}
            />
          </ErrorBoundary>
        ) : (
          <section className="workspace">
            <EmptyWorkspace onNewChat={newChat} onQuickChange={ws.startQuickChange} />
          </section>
        )}

        {showInspector && ws.selectedFeatureId && (
          <Inspector key={`insp-${ws.selectedFeatureId}`} featureId={ws.selectedFeatureId} />
        )}
      </div>

      <StatusBar
        projectId={projectId}
        activeFeatureId={ws.selectedFeatureId}
        driving={driving}
        onDriveChange={setDriving}
      />

      <CommandPalette
        open={ws.cmdkOpen}
        onClose={() => ws.setCmdk(false)}
        features={list.data ?? []}
        selectedFeatureId={ws.selectedFeatureId}
        onSelect={ws.select}
        onOpenSettings={() => ws.openSettings()}
        onOpenPreparation={ws.startPreparation}
        // The palette navigates, it never launches: this opens the project
        // workspace, where the conversation list decides new-versus-resume.
        onOpenProjectChat={ws.selectProject}
        nav={nav}
      />

      {ws.settings && (
        <SettingsDialog
          projectId={projectId}
          projectName={nav.currentProject?.name ?? ''}
          location={ws.settings}
          onClose={ws.closeSettings}
        />
      )}
    </div>
  )

  // Anything under the shell — a ticket's error, a burn lane — can turn a
  // "Settings → Burns" pointer into a link that lands on the row it names.
  return <OpenSettingsProvider open={ws.openSettings}>{shell}</OpenSettingsProvider>
}

/**
 * The project home — the screen you land on with no feature selected. An
 * unprepared project with no features never sees it: `workspaceView` gives the
 * body to preparation instead, because there is exactly one thing to do first
 * and putting it beside these buttons is what made it invisible.
 */
function EmptyWorkspace({
  onNewChat,
  onQuickChange,
}: {
  onNewChat: () => void
  onQuickChange: () => void
}) {
  return (
    <div className="ws-empty">
      <div className="ws-empty-inner">
        <div className="ws-empty-logo">
          <LogoMark size={44} variant="outline" />
        </div>
        <div className="ws-empty-title">Select a feature to begin</div>
        <div className="ws-empty-sub">Or start one — every feature moves through the same guided pipeline.</div>
        {/* The rail head's two doors, said again where a project with nothing
            selected is looking for them (decisions.md #12). */}
        <div className="ws-empty-actions">
          <button className="btn btn-ghost" onClick={onNewChat}>
            New chat
          </button>
          <button className="btn btn-ghost" onClick={onQuickChange}>
            Quick
          </button>
        </div>
        <div className="ws-empty-hint">
          New opens a conversation with the project — it knows what you have already built, and cuts
          a lump of intent into features. Quick skips the conversation: a change to burn now, or a
          draft to park.
        </div>
      </div>
    </div>
  )
}
