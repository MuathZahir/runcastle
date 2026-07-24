import { trpc } from '../trpc'
import { aggregateRuns, projectStats } from '../lib/projects'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconBranch, IconPanelRight, IconSearch, IconSettings, LogoMark, LogoWordmark } from '../icons'
import { ProjectSwitcher } from './ProjectSwitcher'

/**
 * The IDE title bar (app-redesign, multi-project #45): brand · project switcher ·
 * main branch on the left; a ⌘K search launcher, an aggregate cross-project runs
 * pill, the server-health dot, and the inspector toggle on the right. The runs
 * pill counts runs across every open project so background work stays visible
 * whichever project you're in. The brand mark returns to the portfolio home.
 */
export function Titlebar({
  nav,
  onOpenCmdk,
  onOpenSettings,
  onToggleInspector,
  inspectorCollapsed,
}: {
  nav: ProjectNavApi
  onOpenCmdk: () => void
  onOpenSettings: () => void
  onToggleInspector: () => void
  inspectorCollapsed: boolean
}) {
  const projects = nav.projects ?? []

  // Aggregate runs across ALL open projects (not just the current one).
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: 1500 })),
  )
  const stats = featureQueries.map((q) => projectStats(q.data ?? []))
  const runCount = aggregateRuns(stats)
  const healthy = !featureQueries.some((q) => q.isError)

  return (
    <header className="titlebar">
      <button
        className="tb-home"
        onClick={nav.goHome}
        title={projects.length > 1 ? 'All projects' : 'runcastle'}
      >
        <span className="tb-logo">
          <LogoMark size={17} />
        </span>
        <LogoWordmark />
      </button>
      <span className="tb-arrow">/</span>
      <ProjectSwitcher nav={nav} />
      <span className="tb-branch">
        <IconBranch size={12} />
        {nav.currentProject?.mainBranch ?? 'main'}
      </span>

      <span className="tb-spacer" />

      <button className="tb-search" onClick={onOpenCmdk} title="Search or jump to (⌘K)">
        <IconSearch size={13} />
        <span>Search or jump to…</span>
        <span className="tb-search-spacer" />
        <span className="kbd">⌘K</span>
      </button>

      {runCount > 0 && (
        <button
          className="tb-runs"
          onClick={nav.goHome}
          title="Runs in flight across all projects — open the portfolio"
        >
          <span className="spin-ring" />
          {runCount} run{runCount === 1 ? '' : 's'}
        </button>
      )}

      <span
        className={`tb-health ${healthy ? 'is-ok' : 'is-down'}`}
        title={healthy ? 'server healthy' : 'server down'}
      >
        <span className="health-dot" />
      </span>

      <button className="tb-icon-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
        <IconSettings size={14} />
      </button>

      <button
        className={`tb-icon-btn${inspectorCollapsed ? '' : ' is-on'}`}
        title={inspectorCollapsed ? 'Show details panel' : 'Hide details panel'}
        aria-label={inspectorCollapsed ? 'Show details panel' : 'Hide details panel'}
        onClick={onToggleInspector}
      >
        <IconPanelRight size={14} />
      </button>
    </header>
  )
}
