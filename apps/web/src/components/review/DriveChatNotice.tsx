import { Button } from '../../ui'
import { IconSend, IconStop } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { DRIVE_HOLDS_THE_AGENT, unsentNotes } from './SendToAgent'

/**
 * The one line a feature's chat page says about its drive: while one runs, that
 * the agent is held and how to let it go (test-drive-looks-the-part decision
 * 20); after it, the notes that were never sent (decision 13).
 */
export function DriveChatNotice({
  featureId,
  driving,
  stopping,
  onStop,
}: {
  featureId: string
  driving: boolean
  stopping: boolean
  onStop: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const notes = trpc.notes.list.useQuery({ featureId })
  const send = trpc.notes.send.useMutation({
    onSuccess: () => {
      void utils.notes.list.invalidate({ featureId })
      void utils.notes.delivery.invalidate({ featureId })
    },
    onError: (e) => toast.push(e.message),
  })
  const unsent = unsentNotes(notes.data ?? []).length
  if (!driving && unsent === 0) return null
  return (
    <div className="card flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary">
      <span className="min-w-0 flex-1 text-pretty">
        {driving ? DRIVE_HOLDS_THE_AGENT : `${unsent} ${unsent === 1 ? 'note' : 'notes'} from your drive, not sent yet`}
      </span>
      {driving ? (
        <Button size="sm" icon={<IconStop />} loading={stopping} onClick={onStop}>
          Stop drive
        </Button>
      ) : (
        <Button size="sm" icon={<IconSend />} loading={send.isPending} onClick={() => send.mutate({ featureId })}>
          Send to the agent
        </Button>
      )}
    </div>
  )
}
