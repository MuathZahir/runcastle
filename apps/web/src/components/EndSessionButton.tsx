import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button } from '../ui'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { IconStop } from '../icons'

interface EndSessionProps {
  /** Absent on a project-scoped session — there is no feature to refresh. */
  featureId?: string
  sessionId: string
  /** Extra refresh the owning surface needs (the project session's own row). */
  onEnded?: () => void
}

/** The end itself, shared by the button and the switcher's menu item. */
function useEndSession({ featureId, onEnded }: Omit<EndSessionProps, 'sessionId'>) {
  const utils = trpc.useUtils()
  const toast = useToast()
  return trpc.feature.endSession.useMutation({
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
}

const END_TITLE = 'end this session — recoverable, you can relaunch it'

/**
 * One-click End-session control shown wherever a live/launching session strip
 * renders (the preparation chat): a ghost in `danger`, with the stop glyph.
 * Confirm-free on purpose: ending is
 * recoverable — a session can always be relaunched — and after a server
 * restart this button is the only way out of a "live" row over a dead PTY, so
 * it must work even when the terminal is blank.
 */
export function EndSessionButton({ featureId, sessionId, onEnded }: EndSessionProps) {
  const end = useEndSession({ featureId, onEnded })

  return (
    <Button
      variant="danger-ghost"
      size="sm"
      icon={<IconStop />}
      loading={end.isPending}
      title={END_TITLE}
      onClick={() => end.mutate({ sessionId })}
    >
      {end.isPending ? 'Ending…' : 'End session'}
    </Button>
  )
}

/** End session as a row of the chat column's session switcher (design-mode decision 12). */
export function EndSessionItem({ featureId, sessionId, onEnded }: EndSessionProps) {
  const end = useEndSession({ featureId, onEnded })
  return (
    <DropdownMenuItem
      tone="danger"
      icon={<IconStop />}
      title={END_TITLE}
      disabled={end.isPending}
      onSelect={() => end.mutate({ sessionId })}
    >
      End session
    </DropdownMenuItem>
  )
}
