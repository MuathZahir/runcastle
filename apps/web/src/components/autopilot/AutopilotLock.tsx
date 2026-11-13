import { useState } from 'react'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import type { EpicColor } from '../../lib/epic-look'
import { AutopilotLockNote, EndAutopilotDialog } from './AutopilotParts'

/** A locked feature's epic, as the server says it (`feature.get`'s `autopilot`). */
export interface FeatureAutopilot {
  epicId: string
  epicName: string
}

/**
 * What stands in a locked chat's message box (epics-on-autopilot decisions 3,
 * 8, 16, 20): the lock note, wired. "Open the epic" brings the epic's chat to
 * the front; "End autopilot" asks once, then ends the epic's autopilot through
 * `feature.endAutopilot`, which works with no orchestrator turn. The confirm
 * names every feature the epic gives back. Its event (and the invalidation
 * here) turns the page back into an ordinary one.
 */
export function AutopilotLock({
  projectId,
  autopilot,
  color,
  working = false,
  onOpenEpic,
}: {
  projectId: string
  autopilot: FeatureAutopilot
  color?: EpicColor | null | undefined
  /** The epic is at work: the glyph's orbit turns. */
  working?: boolean
  /** Open the epic's chat; the button is a no-op without it. */
  onOpenEpic?: ((epicId: string) => void) | undefined
}) {
  const [confirm, setConfirm] = useState(false)
  const utils = trpc.useUtils()
  const toast = useToast()
  // The same list the sidebar reads: the features this epic holds locked, by title.
  const list = trpc.feature.list.useQuery({ projectId })
  const locked = (list.data ?? []).filter((f) => f.autopilot?.epicId === autopilot.epicId).map((f) => f.title)
  const end = trpc.feature.endAutopilot.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate()
      void utils.feature.list.invalidate()
      void utils.thread.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  const epic = { title: autopilot.epicName, color: color ?? null }
  return (
    <>
      <AutopilotLockNote
        epic={epic}
        working={working}
        onOpenEpic={() => onOpenEpic?.(autopilot.epicId)}
        onEndAutopilot={() => setConfirm(true)}
      />
      <EndAutopilotDialog
        open={confirm}
        epic={autopilot.epicName}
        features={locked}
        busy={end.isPending}
        onEnd={() => end.mutate({ epicId: autopilot.epicId })}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
