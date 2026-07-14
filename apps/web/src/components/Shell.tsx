import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { useTabs, tabId, type DriveState, type Tab } from '../lib/tabs'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { OverviewTab } from './tabs/OverviewTab'
import { TicketsTab } from './tabs/TicketsTab'
import { RunTab } from './tabs/RunTab'
import { TerminalTab } from './tabs/TerminalTab'

const INSPECTOR_KEY = 'runcastle.inspector.collapsed'

/**
 * The IDE shell (UI-SPEC §2): 36px title bar, three columns (Features / tabs /
 * Inspector), 24px status bar. Owns the tab set, the active test-drive state,
 * and the inspector-collapse toggle. Every open tab stays mounted (hidden when
 * inactive) so switching features loses nothing — terminals stay attached,
 * scroll positions and event logs persist (S8).
 */
export function Shell() {
  const tabs = useTabs()
  const [driving, setDriving] = useState<DriveState | null>(null)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => localStorage.getItem(INSPECTOR_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(INSPECTOR_KEY, inspectorCollapsed ? '1' : '0')
  }, [inspectorCollapsed])

  const project = trpc.project.get.useQuery(undefined, { refetchInterval: 5000 })
  const list = trpc.feature.list.useQuery(undefined, { refetchInterval: 1500 })
  const runCount = list.data?.filter((f) => f.activeRun).length ?? 0
  const healthy = !list.isError && list.data !== undefined

  const activeFeatureId = tabs.activeTab?.featureId ?? null

  const openTab = (tab: Tab) => tabs.open(tab)

  return (
    <div className={`shell${inspectorCollapsed ? ' inspector-collapsed' : ''}`}>
      <header className="titlebar">
        <div className="tb-brand">
          <span className="tb-app mono">runcastle</span>
          <span className="tb-arrow">▸</span>
          <span className="tb-project mono">{project.data?.name ?? '…'}</span>
          <span className="tb-dot">·</span>
          <span className="tb-branch mono">{project.data?.mainBranch ?? 'main'}</span>
        </div>
        <div className="tb-right">
          <span className="tb-runs mono">
            {runCount} run{runCount === 1 ? '' : 's'}
            {runCount > 0 && <span className="tb-run-spin" />}
          </span>
          <span className={`tb-health ${healthy ? 'is-ok' : 'is-down'}`} title={healthy ? 'server healthy' : 'server down'}>
            <span className="health-dot" />
          </span>
          <button
            className="tb-chevron"
            title={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
            onClick={() => setInspectorCollapsed((v) => !v)}
          >
            {inspectorCollapsed ? '◀' : '▶'}
          </button>
        </div>
      </header>

      <div className="shell-body">
        <Sidebar activeFeatureId={activeFeatureId} onSelect={tabs.openFeature} />

        <main className="center">
          <TabStrip
            tabs={tabs.tabs}
            activeId={tabs.activeId}
            onFocus={tabs.focus}
            onClose={tabs.close}
          />
          <div className="tab-content">
            {tabs.tabs.length === 0 && (
              <div className="workspace-empty">
                <span className="dim-line mono">select a feature to begin</span>
              </div>
            )}
            {tabs.tabs.map((tab) => {
              const id = tabId(tab)
              const active = id === tabs.activeId
              return (
                <div key={id} className="tab-pane" hidden={!active}>
                  {renderTab(tab, { driving, setDriving, openTab })}
                </div>
              )
            })}
          </div>
        </main>

        {!inspectorCollapsed && activeFeatureId && (
          <Inspector key={activeFeatureId} featureId={activeFeatureId} />
        )}
      </div>

      <StatusBar
        activeFeatureId={activeFeatureId}
        driving={driving}
        onDriveChange={setDriving}
      />
    </div>
  )
}

function renderTab(
  tab: Tab,
  ctx: {
    driving: DriveState | null
    setDriving: (d: DriveState | null) => void
    openTab: (tab: Tab) => void
  },
) {
  switch (tab.kind) {
    case 'overview':
      return (
        <OverviewTab
          featureId={tab.featureId}
          driving={ctx.driving}
          onOpenTab={ctx.openTab}
          onDriveChange={ctx.setDriving}
        />
      )
    case 'terminal':
      return <TerminalTab featureId={tab.featureId} sessionId={tab.sessionId} />
    case 'tickets':
      return <TicketsTab featureId={tab.featureId} onOpenTab={ctx.openTab} />
    case 'run':
      return <RunTab featureId={tab.featureId} runId={tab.runId} />
  }
}
