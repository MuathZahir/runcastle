import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { useWorkspace, type DriveState } from '../lib/workspace'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { Workspace } from './Workspace'
import { NewFeatureForm } from './NewFeatureForm'
import { CommandPalette } from './CommandPalette'
import { UpdateBanner } from './UpdateBanner'

/**
 * The runcastle IDE shell (app-redesign) — pipeline-first, no tabs. A title bar,
 * a triage features rail, a single workspace bound to the selected feature (or
 * the new-feature form), the inspector rail, and a status bar. ⌘K opens the
 * command palette from anywhere. The active test drive (at most one globally) is
 * shell state, shared by the workspace and the status bar.
 */
export function Shell() {
  const ws = useWorkspace()
  const { selectedFeatureId, select, setCmdk } = ws
  const [driving, setDriving] = useState<DriveState | null>(null)
  const list = trpc.feature.list.useQuery(undefined, { refetchInterval: 1500 })

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
      <UpdateBanner />
      <Titlebar
        onOpenCmdk={() => ws.setCmdk(true)}
        onToggleInspector={ws.toggleInspector}
        inspectorCollapsed={ws.inspectorCollapsed}
      />

      <div className="shell-body">
        <Sidebar
          selectedFeatureId={ws.selectedFeatureId}
          onSelect={ws.select}
          onNewFeature={ws.startCreate}
        />

        {ws.creating ? (
          <section className="workspace">
            <NewFeatureForm onCancel={ws.cancelCreate} onCreated={ws.select} />
          </section>
        ) : ws.selectedFeatureId ? (
          <Workspace
            key={`ws-${ws.selectedFeatureId}`}
            featureId={ws.selectedFeatureId}
            viewedPhase={ws.viewedPhase}
            onViewPhase={ws.viewPhase}
            guidance={ws.guidance}
            driving={driving}
            onDriveChange={setDriving}
          />
        ) : (
          <section className="workspace">
            <EmptyWorkspace onNewFeature={ws.startCreate} />
          </section>
        )}

        {showInspector && ws.selectedFeatureId && (
          <Inspector key={`insp-${ws.selectedFeatureId}`} featureId={ws.selectedFeatureId} />
        )}
      </div>

      <StatusBar
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
      />
    </div>
  )
}

function EmptyWorkspace({ onNewFeature }: { onNewFeature: () => void }) {
  return (
    <div className="ws-empty">
      <div className="ws-empty-logo mono">r</div>
      <span className="dim-line mono">select a feature to begin</span>
      <button className="btn btn-ghost btn-xs" onClick={onNewFeature}>
        + New feature
      </button>
    </div>
  )
}
