import { trpc } from '../../trpc'
import { holderSentence } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { Button } from '../../ui'

/**
 * A project drive holding the one drive slot, as a quiet line under the
 * feature's state line (project-level-test-drive decision 9). The drive is the
 * human's own session on the project page, so nothing here preempts it — but a
 * forgotten one quietly blocks this feature's Test drive, and naming it with a
 * one-click Stop at the point of blocking is the whole remedy.
 *
 * Its own component so the stop mutation exists only while a project drive is
 * actually in the way.
 */
export function ProjectDriveBlocking({
  projectId,
  holderLabel,
}: {
  projectId: string
  /** The server's own name for the drive ("a project drive of main"), verbatim. */
  holderLabel: string
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const stop = trpc.project.testDrive.useMutation({
    onSuccess: () => void utils.feature.driveInfo.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  return (
    <p className="m-0 flex items-center gap-2 text-sm text-text-2" role="status">
      <span>{holderSentence(holderLabel)} is running</span>
      <span aria-hidden="true">·</span>
      <Button
        size="xs"
        disabled={stop.isPending}
        onClick={() => stop.mutate({ projectId, action: 'stop' })}
      >
        {stop.isPending ? 'Stopping…' : 'Stop it'}
      </Button>
    </p>
  )
}
