import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useDesktopNotifications } from '../lib/use-notifications'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { SANDBOX_MODE } from '../lib/env'
import { notifyButton } from '../lib/notifications'
import type { DriveState } from '../lib/workspace'
import type { WorkspaceView } from '../lib/project-workspace'
import { IconBell, IconBellOff, IconBranch, IconShield } from '../icons'

/** Where this page's tRPC calls go — the links are same-origin `/api/trpc`. */
function apiOrigin(): string {
  return typeof window === 'undefined' ? 'this machine' : window.location.origin
}

/**
 * Bottom status bar for the pipeline-first shell (app-redesign): active-feature
 * branch (click = copy) · sandbox mode · test-drive state (driving — stop) ·
 * active run count · server health dot.
 */
export function StatusBar({
  projectId,
  activeFeatureId,
  driving,
  onDriveChange,
}: {
  projectId: string
  /**
   * Which surface owns the workspace body. The seam the status-bar redesign
   * consumes (decision 8): the branch segment states the selected feature's
   * branch on feature views and nothing anywhere else, rather than leaving the
   * previous feature's branch up as though it were current.
   */
  view: WorkspaceView
  activeFeatureId: string | null
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const live = useLiveStatus()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const healthy = !list.isError && list.data !== undefined
  const active = list.data?.find((f) => f.id === activeFeatureId)
  const runCount = list.data?.filter((f) => f.activeRun).length ?? 0
  const notify = useDesktopNotifications(projectId, list.data ?? [])
  const notifyState = notifyButton(notify)

  const stopDrive = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      onDriveChange(null)
      if (driving) utils.feature.get.invalidate({ id: driving.featureId })
      utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const copyBranch = () => {
    if (!active) return
    navigator.clipboard.writeText(active.branch).then(
      () => toast.push(`copied ${active.branch}`, 'info'),
      () => toast.push('copy failed'),
    )
  }

  return (
    <footer className="statusbar">
      {active && (
        <button className="sb-branch" onClick={copyBranch} title="Copy branch name">
          <IconBranch size={11} />
          {active.branch}
        </button>
      )}
      <span className="sb-item" title={`Agent sessions run sandboxed via ${SANDBOX_MODE}`}>
        <IconShield size={11} />
        {SANDBOX_MODE}
      </span>
      {driving && (
        <span className="sb-driving">
          <span className="sb-driving-dot" />
          driving <span className="mono">{driving.branch}</span>
          <button
            className="sb-stop"
            disabled={stopDrive.isPending}
            onClick={() => stopDrive.mutate({ featureId: driving.featureId, action: 'stop' })}
          >
            stop
          </button>
        </span>
      )}
      <span className="sb-spacer" />
      {notify.supported && (
        <button
          className={`sb-notify is-${notifyState.state}`}
          onClick={notify.toggle}
          title={notifyState.title}
        >
          {notifyState.state === 'on' ? <IconBell size={12} /> : <IconBellOff size={12} />}
          {notifyState.label}
        </button>
      )}
      <span className="sb-item">
        {runCount} run{runCount === 1 ? '' : 's'}
      </span>
      {/* Data-stream health, not the terminal's (that one has its own OFFLINE
          banner in the workspace). A dead stream used to be invisible, which is
          what made staleness feel haunted — quiet dot while it flows, amber
          word while it does not. No toast: reconnects are routine. */}
      <span
        className={`sb-item sb-live ${live === 'live' ? 'is-live' : 'is-degraded'}`}
        title={
          live === 'live'
            ? 'Live updates are streaming from the server'
            : 'Live updates paused — reconnecting, and polling meanwhile'
        }
      >
        <span className="sb-live-dot" />
        {live === 'live' ? 'live' : 'reconnecting…'}
      </span>
      {/* Says "server", not ":4512". The port was a hardcoded constant that kept
          claiming 4512 on an instance running anywhere else (findings F14) —
          and a health chip that can be wrong about which server it is talking
          to is worse than one that does not name it. The origin the API calls
          actually go to is on the tooltip, where it can never go stale. */}
      <span
        className={`sb-item sb-health ${healthy ? 'is-ok' : 'is-down'}`}
        title={`runcastle API at ${apiOrigin()}/api`}
      >
        <span className="health-dot" />
        server {healthy ? 'ok' : 'down'}
      </span>
    </footer>
  )
}
