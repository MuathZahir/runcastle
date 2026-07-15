import { Tabs } from '../components/Tabs'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { OverviewScreen } from './OverviewScreen'
import { TicketsScreen } from './TicketsScreen'
import { RunScreen } from './RunScreen'
import { TerminalScreen } from './TerminalScreen'

export interface AppShellProps {
  /** Which tab body fills the center pane. */
  activeTab?: 'overview' | 'tickets' | 'run' | 'terminal'
  /** Hide the right inspector rail. */
  inspectorCollapsed?: boolean
}

const TABS = [
  { id: 'overview', label: 'auth-flow', type: 'overview', icon: '▤' },
  { id: 'terminal', label: 'auth-flow', type: 'term', icon: '▸_' },
  { id: 'tickets', label: 'auth-flow', type: 'tickets', icon: '☰' },
  { id: 'run', label: 'auth-flow', type: 'run', icon: '⚙' },
]

/**
 * The whole runcastle IDE in one frame: title bar, features rail, a typed tab
 * strip over the active screen, the inspector rail, and the status bar. Pick
 * which tab body shows with `activeTab`. This is the top-level canvas to
 * redesign — the individual Screens are its parts.
 * @category Screens
 */
export function AppShell({ activeTab = 'overview', inspectorCollapsed = false }: AppShellProps) {
  const center =
    activeTab === 'tickets' ? <TicketsScreen /> :
    activeTab === 'run' ? <RunScreen /> :
    activeTab === 'terminal' ? <TerminalScreen /> :
    <OverviewScreen />

  return (
    <div className={`shell${inspectorCollapsed ? ' inspector-collapsed' : ''}`}>
      <Titlebar inspectorCollapsed={inspectorCollapsed} />
      <div className="shell-body">
        <Sidebar />
        <main className="center">
          <Tabs tabs={TABS} activeId={activeTab} />
          <div className="tab-content">
            <div className="tab-pane">{center}</div>
          </div>
        </main>
        {!inspectorCollapsed && <Inspector />}
      </div>
      <StatusBar />
    </div>
  )
}
