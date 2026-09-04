import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useDesktopNotifications } from '../lib/use-notifications'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { SANDBOX_MODE } from '../lib/env'
import { notifyButton, type NotifyState } from '../lib/notifications'
import type { DriveState } from '../lib/workspace'
import type { WorkspaceView } from '../lib/project-workspace'
import { IconBell, IconBellOff, IconBranch, IconShield } from '../icons'

/** Where this page's tRPC calls go — the links are same-origin `/api/trpc`. */
function apiOrigin(): string {
  return typeof window === 'undefined' ? 'this machine' : window.location.origin
}

/** One segment, whether it is a button or a plain reading. */
const SB_ITEM = 'inline-flex shrink-0 items-center gap-1.5'

/** A segment you can click — no preflight, so it states its own reset. */
const SB_BUTTON = `${SB_ITEM} cursor-pointer rounded-sm border-0 bg-transparent p-0 text-xs`

/** The notify toggle's colour, by what `notifyButton` chose to say. */
const NOTIFY_FG: Record<NotifyState, string> = {
  on: 'text-ok',
  off: 'text-text-3 group-hover:text-text',
  blocked: 'text-warn',
}

/**
 * Bottom status bar for the pipeline-first shell (decisions 7–8). Left to
 * right: the selected feature's branch (click = copy), the sandbox mode, the
 * live test drive with its stop; then, past the spacer, the notify toggle, the
 * data-stream dot and server health.
 *
 * Two things are deliberately absent. The per-project run count is gone
 * (decision 7): the rail's "Agent working" lane already itemises this project's
 * running work by name, and having both say a number is how the frame ended up
 * with four counts that disagreed. And the branch segment is bound to the view
 * (decision 8) rather than to whatever feature was selected last — it used to
 * keep the previous feature's branch up on chat and preparation, stating a stale
 * fact as though it were current.
 */
export function StatusBar({
  projectId,
  view,
  activeFeatureId,
  driving,
  onDriveChange,
}: {
  projectId: string
  /**
   * Which surface owns the workspace body. The seam the status-bar redesign
   * consumes (decision 8): the branch segment states the selected feature's
   * branch on feature views and nothing anywhere else.
   */
  view: WorkspaceView
  activeFeatureId: string | null
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const bar = useStatusBar({ projectId, view, activeFeatureId, driving, onDriveChange })
  return <StatusBarChrome {...bar} />
}

/** Everything the bar renders, once the queries behind it have answered. */
export interface StatusBarState {
  /** The selected feature's branch — `null` on every view that has no feature. */
  branch: string | null
  onCopyBranch: () => void
  driving: DriveState | null
  onStopDrive: () => void
  stopPending: boolean
  /** `null` when the browser has no Notification API to toggle. */
  notify: (ReturnType<typeof notifyButton> & { onToggle: () => void }) | null
  live: ReturnType<typeof useLiveStatus>
  healthy: boolean
  /** The origin the API calls actually go to, for the health chip's tooltip. */
  origin: string
}

function useStatusBar({
  projectId,
  view,
  activeFeatureId,
  driving,
  onDriveChange,
}: {
  projectId: string
  view: WorkspaceView
  activeFeatureId: string | null
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}): StatusBarState {
  const toast = useToast()
  const utils = trpc.useUtils()
  const live = useLiveStatus()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const healthy = !list.isError && list.data !== undefined
  const active = view === 'feature' ? list.data?.find((f) => f.id === activeFeatureId) : undefined
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

  const branch = active?.branch ?? null

  return {
    branch,
    onCopyBranch: () => {
      if (!branch) return
      navigator.clipboard.writeText(branch).then(
        () => toast.push(`copied ${branch}`, 'info'),
        () => toast.push('copy failed'),
      )
    },
    driving,
    onStopDrive: () => {
      if (driving) stopDrive.mutate({ featureId: driving.featureId, action: 'stop' })
    },
    stopPending: stopDrive.isPending,
    notify: notify.supported ? { ...notifyState, onToggle: notify.toggle } : null,
    live,
    healthy,
    origin: apiOrigin(),
  }
}

/**
 * The bar as markup, with every query already resolved to a value — the seam
 * the rendered-chrome tests observe it at (apps/web/STYLE.md, tier 1).
 */
export function StatusBarChrome({
  branch,
  onCopyBranch,
  driving,
  onStopDrive,
  stopPending,
  notify,
  live,
  healthy,
  origin,
}: StatusBarState) {
  return (
    <footer className="flex items-center gap-4 border-t border-hairline bg-panel px-3 text-xs text-text-3">
      {branch && (
        <button
          className={`group ${SB_BUTTON} font-mono`}
          onClick={onCopyBranch}
          title="Copy branch name"
        >
          <IconBranch size={11} />
          <span className="group-hover:text-text">{branch}</span>
        </button>
      )}
      <span className={SB_ITEM} title={`Agent sessions run sandboxed via ${SANDBOX_MODE}`}>
        <IconShield size={11} />
        {SANDBOX_MODE}
      </span>
      {driving && (
        <span className={`${SB_ITEM} gap-2 text-drive`}>
          <span className="size-1.5 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-drive" />
          driving <span className="font-mono">{driving.branch}</span>
          <button
            className="h-4 cursor-pointer rounded-[4px] border border-drive/40 bg-transparent px-1.5 text-xs disabled:cursor-default"
            disabled={stopPending}
            onClick={onStopDrive}
          >
            <span className="text-drive">stop</span>
          </button>
        </span>
      )}
      <span className="flex-1" />
      {notify && (
        <button className={`group ${SB_BUTTON}`} onClick={notify.onToggle} title={notify.title}>
          <span className={`inline-flex items-center gap-1.5 ${NOTIFY_FG[notify.state]}`}>
            {notify.state === 'on' ? <IconBell size={12} /> : <IconBellOff size={12} />}
            {notify.label}
          </span>
        </button>
      )}
      {/* Data-stream health, not the terminal's (that one has its own OFFLINE
          banner in the workspace). A dead stream used to be invisible, which is
          what made staleness feel haunted — quiet dot while it flows, amber
          word while it does not. No toast: reconnects are routine. */}
      <span
        className={`${SB_ITEM} ${live === 'live' ? '' : 'text-warn'}`}
        title={
          live === 'live'
            ? 'Live updates are streaming from the server'
            : 'Live updates paused — reconnecting, and polling meanwhile'
        }
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            live === 'live' ? 'bg-ok' : 'animate-[pulse_1.4s_ease-in-out_infinite] bg-warn'
          }`}
        />
        {live === 'live' ? 'live' : 'reconnecting…'}
      </span>
      {/* The frame's one health indicator (decision 7) — the titlebar's dot was
          driven by a different query and could disagree with this one. It says
          "server", not ":4512": the port was a hardcoded constant that kept
          claiming 4512 on an instance running anywhere else (findings F14), and
          a chip that can be wrong about which server it is talking to is worse
          than one that does not name it. The origin the API calls actually go to
          is on the tooltip, where it can never go stale. */}
      <span className={SB_ITEM} title={`runcastle API at ${origin}/api`}>
        <span
          className={`size-2 shrink-0 rounded-full ${
            healthy ? 'bg-ok' : 'animate-[pulse_1s_ease-in-out_infinite] bg-danger'
          }`}
        />
        server {healthy ? 'ok' : 'down'}
      </span>
    </footer>
  )
}
