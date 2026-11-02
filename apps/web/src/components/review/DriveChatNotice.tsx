import { Button } from '../../ui'
import { IconSend, IconStop } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { DRIVE_HOLDS_THE_AGENT, stopThenSend, unsentNotes } from './SendToAgent'

/**
 * The one line a feature's chat page says about its drive: while one runs, that
 * the agent is held and how to let it go (test-drive-looks-the-part decision
 * 20), with any notes sent in the same click as the stop (small-fixes-before-
 * publish decision 8); after it, any notes not sent yet (decision 13).
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
  /** Stop this feature's drive; rejects when the stop fails. */
  onStop: () => Promise<unknown>
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
  const sendNotes = () => send.mutate({ featureId })
  const unsent = unsentNotes(notes.data ?? []).length
  if (!driving && unsent === 0) return null
  return (
    <div className="flex items-center gap-3 px-1 text-sm text-text-secondary">
      <span className="min-w-0 flex-1 text-pretty">
        {driving ? DRIVE_HOLDS_THE_AGENT : `${unsent} ${unsent === 1 ? 'note' : 'notes'} not sent yet`}
      </span>
      {driving && unsent > 0 ? (
        <>
          <Button size="sm" variant="ghost" loading={send.isPending} onClick={sendNotes}>
            Send, keep driving
          </Button>
          <Button size="sm" icon={<IconSend />} loading={stopping} onClick={() => stopThenSend(onStop, sendNotes)}>
            Send and stop drive
          </Button>
        </>
      ) : driving ? (
        <Button size="sm" icon={<IconStop />} loading={stopping} onClick={() => void onStop().catch(() => undefined)}>
          Stop drive
        </Button>
      ) : (
        <Button size="sm" icon={<IconSend />} loading={send.isPending} onClick={sendNotes}>
          Send to the agent
        </Button>
      )}
    </div>
  )
}
