import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button } from '../ui'

/**
 * One-click End-session control shown wherever a live/launching session strip
 * renders (grill body, tickets body). Confirm-free on purpose: ending is
 * recoverable — a session can always be relaunched — and after a server
 * restart this button is the only way out of a "live" row over a dead PTY, so
 * it must work even when the terminal is blank.
 */
export function EndSessionButton({
  featureId,
  sessionId,
  onEnded,
}: {
  /** Absent on a project-scoped session — there is no feature to refresh. */
  featureId?: string
  sessionId: string
  /** Extra refresh the owning surface needs (the project session's own row). */
  onEnded?: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const end = trpc.feature.endSession.useMutation({
    onSuccess: () => {
      if (featureId) {
        void utils.feature.get.invalidate({ id: featureId })
        void utils.feature.list.invalidate()
      }
      onEnded?.()
      toast.push('session ended', 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <Button
      type="button"
      size="xs"
      className="sess-end"
      disabled={end.isPending}
      title="end this session — recoverable, you can relaunch it"
      onClick={() => end.mutate({ sessionId })}
    >
      {end.isPending ? 'Ending…' : 'End session'}
    </Button>
  )
}
