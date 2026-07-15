export interface StatusBarProps {
  /** Active feature branch (mono, click-to-copy in the app). */
  branch?: string
  /** Sandbox mode label. */
  sandbox?: string
  /** Test-drive branch, or null when off. */
  driving?: string | null
  /** Active run count. */
  runs?: number
  /** Server health + port. */
  healthy?: boolean
  port?: number
}

/**
 * The 24px status bar: active branch · sandbox mode · test-drive state · a
 * flexible spacer · run count · server health dot with port.
 * @category Screens
 */
export function StatusBar({
  branch = 'fix/ship-path-bugs',
  sandbox = 'worktree',
  driving = null,
  runs = 2,
  healthy = true,
  port = 4512,
}: StatusBarProps) {
  return (
    <footer className="statusbar mono">
      <button className="sb-item sb-branch" title="click to copy">{branch}</button>
      <span className="sb-sep">·</span>
      <span className="sb-item">sandbox: {sandbox}</span>
      <span className="sb-sep">·</span>
      {driving ? (
        <span className="sb-item sb-driving">
          driving {driving}
          <button className="sb-stop">Stop</button>
        </span>
      ) : (
        <span className="sb-item">test drive: off</span>
      )}
      <span className="sb-spacer" />
      <span className="sb-item">{runs} run{runs === 1 ? '' : 's'}</span>
      <span className="sb-sep">·</span>
      <span className={`sb-item sb-health ${healthy ? 'is-ok' : 'is-down'}`}>
        <span className="health-dot" />
        {port} {healthy ? 'ok' : 'down'}
      </span>
    </footer>
  )
}
