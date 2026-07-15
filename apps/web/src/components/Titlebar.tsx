import { trpc } from '../trpc'

/**
 * The IDE title bar (app-redesign): brand · project · main branch on the left;
 * a ⌘K search launcher, a live-runs pill, the server-health dot, and the
 * inspector toggle on the right. Reads project + feature list itself so the
 * Shell stays lean.
 */
export function Titlebar({
  onOpenCmdk,
  onToggleInspector,
  inspectorCollapsed,
}: {
  onOpenCmdk: () => void
  onToggleInspector: () => void
  inspectorCollapsed: boolean
}) {
  const project = trpc.project.get.useQuery(undefined, { refetchInterval: 5000 })
  const list = trpc.feature.list.useQuery(undefined, { refetchInterval: 1500 })
  const runCount = list.data?.filter((f) => f.activeRun).length ?? 0
  const healthy = !list.isError && list.data !== undefined

  return (
    <header className="titlebar">
      <span className="tb-logo mono">r</span>
      <span className="tb-app">runcastle</span>
      <span className="tb-arrow">/</span>
      <span className="tb-project">{project.data?.name ?? '…'}</span>
      <span className="tb-dot">·</span>
      <span className="tb-branch">⎇ {project.data?.mainBranch ?? 'main'}</span>

      <span className="tb-spacer" />

      <button className="tb-search" onClick={onOpenCmdk} title="Search or jump to (⌘K)">
        <span>Search or jump to…</span>
        <span className="tb-search-spacer" />
        <span className="kbd">⌘K</span>
      </button>

      {runCount > 0 && (
        <span className="tb-runs">
          <span className="spin-ring" />
          {runCount} run{runCount === 1 ? '' : 's'}
        </span>
      )}

      <span
        className={`tb-health ${healthy ? 'is-ok' : 'is-down'}`}
        title={healthy ? 'server healthy' : 'server down'}
      >
        <span className="health-dot" />
      </span>

      <button
        className="tb-icon-btn"
        title={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
        onClick={onToggleInspector}
      >
        ▥
      </button>
    </header>
  )
}
