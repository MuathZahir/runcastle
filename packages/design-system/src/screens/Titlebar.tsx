import { Spinner } from '../components/Spinner'

export interface TitlebarProps {
  /** Project name shown after the brand. */
  project?: string
  /** Main branch label. */
  branch?: string
  /** Active run count (shows a spinner when > 0). */
  runs?: number
  /** Server health dot: green when true, red when false. */
  healthy?: boolean
  /** Inspector collapse chevron direction. */
  inspectorCollapsed?: boolean
}

/**
 * The 36px IDE title bar: `runcastle ▸ <project> · <branch>` on the left; run
 * count + spinner, a server-health dot, and the inspector toggle on the right.
 * @category Screens
 */
export function Titlebar({
  project = 'runcastle-web',
  branch = 'main',
  runs = 2,
  healthy = true,
  inspectorCollapsed = false,
}: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="tb-brand">
        <span className="tb-app mono">runcastle</span>
        <span className="tb-arrow">▸</span>
        <span className="tb-project mono">{project}</span>
        <span className="tb-dot">·</span>
        <span className="tb-branch mono">{branch}</span>
      </div>
      <div className="tb-right">
        <span className="tb-runs mono">
          {runs} run{runs === 1 ? '' : 's'}
          {runs > 0 && <Spinner />}
        </span>
        <span className={`tb-health ${healthy ? 'is-ok' : 'is-down'}`} title={healthy ? 'server healthy' : 'server down'}>
          <span className="health-dot" />
        </span>
        <button className="tb-chevron" title="Toggle inspector">{inspectorCollapsed ? '◀' : '▶'}</button>
      </div>
    </header>
  )
}
