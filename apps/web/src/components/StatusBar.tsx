import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { SANDBOX_MODE, SERVER_PORT } from '../lib/env'
import type { DriveState } from '../lib/workspace'

/**
 * Bottom status bar for the pipeline-first shell (app-redesign): active-feature
 * branch (click = copy) · sandbox mode · test-drive state (driving — stop) ·
 * active run count · server health dot + port.
 */
export function StatusBar({
  projectId,
  activeFeatureId,
  driving,
  onDriveChange,
}: {
  projectId: string
  activeFeatureId: string | null
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: 1500 })
  const healthy = !list.isError && list.data !== undefined
  const active = list.data?.find((f) => f.id === activeFeatureId)
  const runCount = list.data?.filter((f) => f.activeRun).length ?? 0

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
        <button className="sb-branch" onClick={copyBranch} title="copy branch">
          ⎇ {active.branch}
        </button>
      )}
      <span className="sb-item">sandbox · {SANDBOX_MODE}</span>
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
      <span className="sb-item">
        {runCount} run{runCount === 1 ? '' : 's'}
      </span>
      <span className={`sb-item sb-health ${healthy ? 'is-ok' : 'is-down'}`}>
        <span className="health-dot" />
        :{SERVER_PORT} {healthy ? 'ok' : 'down'}
      </span>
    </footer>
  )
}
