import { trpc } from '../trpc'
import type { RouterOutputs } from './api'
import { useLivePoll } from './live'
import { isThisProjectDrive } from './project-drive'
import { useToast } from './toast'

/** Whatever holds this project's drive slot, as `feature.driveInfo` reports it. */
export type SlotDrive = NonNullable<RouterOutputs['feature']['driveInfo']>

/**
 * The project drive's client half (project-level-test-drive decision 4): the
 * one drive query every surface already polls, read for this project, and the
 * start/stop mutation.
 */
export interface ProjectDriveApi {
  /** Whatever holds this project's slot — its project drive or any other kind. */
  slot: SlotDrive | null
  /** This project's live drive, or null. */
  drive: SlotDrive | null
  /**
   * Start a drive, landing on `scenario` once the app answers (null: the blank
   * app); `onStarted` runs only when the server took it.
   */
  start: (scenario: string | null, onStarted?: () => void) => void
  stop: (onStopped?: () => void) => void
  starting: boolean
  stopping: boolean
}

export function useProjectDrive(projectId: string): ProjectDriveApi {
  const utils = trpc.useUtils()
  const toast = useToast()
  const driveQ = trpc.feature.driveInfo.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const testDrive = trpc.project.testDrive.useMutation({
    onSuccess: () => void utils.feature.driveInfo.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  const slot = driveQ.data ?? null

  const run = (action: 'start' | 'stop', then?: () => void, scenario?: string | null): void =>
    testDrive.mutate(
      { projectId, action, ...(scenario ? { scenario } : {}) },
      {
        onSuccess: (result) => {
          // A refusal is an answer, not an error: the slot is held, and the
          // server's sentence names by whom.
          if (!result.ok) toast.push(result.deniedReason ?? `the drive could not ${action}`)
          else then?.()
        },
      },
    )

  return {
    slot,
    drive: isThisProjectDrive(slot, projectId) ? slot : null,
    start: (scenario, onStarted) => run('start', onStarted, scenario),
    stop: (onStopped) => run('stop', onStopped),
    starting: testDrive.isPending && testDrive.variables?.action === 'start',
    stopping: testDrive.isPending && testDrive.variables?.action === 'stop',
  }
}
