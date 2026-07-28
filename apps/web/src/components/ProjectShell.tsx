import { useEffect, useState } from 'react'
import { LogoMark } from '../icons'
import { trpc } from '../trpc'
import { useWorkspace, type DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { Workspace } from './Workspace'
import { NewFeatureForm } from './NewFeatureForm'
import { PreparationCard } from './PreparationCard'
import { CommandPalette } from './CommandPalette'
import { SettingsOverlay } from './SettingsOverlay'

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
  const { selectedFeatureId, select, setCmdk } = ws
  const [driving, setDriving] = useState<DriveState | null>(null)
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: 1500 })

  // Land on a feature: select the first one once, if nothing is selected yet.
  useEffect(() => {
    if (!selectedFeatureId && list.data && list.data.length > 0) select(list.data[0].id)
  }, [selectedFeatureId, list.data, select])

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

  const showInspector = !ws.inspectorCollapsed && !!ws.selectedFeatureId && !ws.creating

  return (
    <div className={`shell${ws.inspectorCollapsed ? ' inspector-collapsed' : ''}`}>
      <Titlebar
        nav={nav}
        onOpenCmdk={() => ws.setCmdk(true)}
        onOpenSettings={() => ws.setSettings(true)}
        onToggleInspector={ws.toggleInspector}
        inspectorCollapsed={ws.inspectorCollapsed}
      />

      <div className="shell-body">
        <Sidebar
          projectId={projectId}
          selectedFeatureId={ws.selectedFeatureId}
          onSelect={ws.select}
          onNewFeature={ws.startCreate}
        />

        {ws.creating ? (
          <section className="workspace">
            <NewFeatureForm
              projectId={projectId}
              onCancel={ws.cancelCreate}
              onCreated={ws.select}
            />
          </section>
        ) : ws.selectedFeatureId ? (
          <Workspace
            key={`ws-${ws.selectedFeatureId}`}
            featureId={ws.selectedFeatureId}
            viewedPhase={ws.viewedPhase}
            onViewPhase={ws.viewPhase}
            guidance={ws.guidance}
            mapRailCollapsed={ws.mapRailCollapsed}
            onToggleMapRail={ws.toggleMapRail}
            driving={driving}
            onDriveChange={setDriving}
          />
        ) : (
          <section className="workspace">
            <EmptyWorkspace projectId={projectId} onNewFeature={ws.startCreate} />
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
        onNewFeature={ws.startCreate}
        onOpenSettings={() => ws.setSettings(true)}
        // Preparation lives on the project home and in settings; from the
        // palette, deselecting the feature reveals the home copy in place.
        onOpenPreparation={() => {
          ws.select(null)
          ws.viewPhase(null)
        }}
        nav={nav}
      />

      {ws.settingsOpen && (
        <SettingsOverlay projectId={projectId} onClose={() => ws.setSettings(false)} />
      )}
    </div>
  )
}

/**
 * The project home. Preparation lives here as well as in settings, because it is
 * project-scoped: it has no place in the feature pipeline, and behind a settings
 * overlay it was effectively invisible — you had to already know it existed to
 * find it. This is the one screen you land on with no feature selected.
 */
function EmptyWorkspace({
  projectId,
  onNewFeature,
}: {
  projectId: string
  onNewFeature: () => void
}) {
  return (
    <div className="ws-empty-scroll">
      <div className="ws-empty">
        <div className="ws-empty-logo">
          <LogoMark size={44} variant="outline" />
        </div>
        <div className="ws-empty-title">Select a feature to begin</div>
        <div className="ws-empty-sub">Or create one — every feature moves through the same guided pipeline.</div>
        <button className="btn btn-ghost" onClick={onNewFeature}>
          New feature
        </button>
      </div>
      <div className="ws-empty-aside">
        <PreparationCard projectId={projectId} />
      </div>
    </div>
  )
}
