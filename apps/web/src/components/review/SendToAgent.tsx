import type { TestNote } from '@runcastle/core'
import { Button } from '../../ui'
import { IconSend } from '../../icons'
import { trpc } from '../../trpc'
import { relTimeAgo } from '../../lib/format'
import { useToast } from '../../lib/toast'

/**
 * The notes "Send to agent" would carry: the human's own, not yet sent, and not
 * frozen into a ticket — the server's `notes.send` takes exactly these.
 */
export function unsentNotes(notes: readonly TestNote[]): TestNote[] {
  return notes.filter((n) => n.author === 'human' && n.sentAt === undefined && n.status !== 'promoted')
}

/** What the line beside the button says: what is waiting, or when the last send went. */
export function sendLine(notes: readonly TestNote[], now: number = Date.now()): string {
  const waiting = unsentNotes(notes).length
  if (waiting > 0) return `${waiting} ${waiting === 1 ? 'note' : 'notes'} not sent yet`
  const sent = notes.flatMap((n) => (n.sentAt === undefined ? [] : [n.sentAt]))
  if (sent.length > 0) return `Sent ${relTimeAgo(Math.max(...sent), now)}`
  return 'No notes — sending tells the agent all is good'
}

/** Said while a drive of this feature runs (`the-feature-lead-runs-rounds` decision 19). */
export const DRIVE_HOLDS_THE_AGENT =
  'While this drive runs, the agent can’t start a round or land its own edits.'

/**
 * "Send to agent" (decision 18): every unsent note, screenshots attached, as
 * one message that wakes the feature's agent. Usable during and after a drive,
 * as often as the human likes; with nothing written it sends "all good".
 *
 * Primary only where nothing else on screen holds the primary (the expanded
 * stage's notes aside); on the page the next-step bar does, and this steps
 * down to secondary (DESIGN.md: one primary per view).
 */
export function SendToAgent({
  featureId,
  driveActive = false,
  primary = false,
}: {
  featureId: string
  /** A drive of this feature holds the drive slot. */
  driveActive?: boolean
  primary?: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  // The same query key the notes list reads, so the line and the rows agree.
  const notes = trpc.notes.list.useQuery({ featureId })
  const send = trpc.notes.send.useMutation({
    onSuccess: ({ sent }) => {
      void utils.notes.list.invalidate({ featureId })
      toast.push(
        sent > 0 ? `${sent} ${sent === 1 ? 'note' : 'notes'} sent to the agent` : 'sent to the agent: all good',
        'success',
      )
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{sendLine(notes.data ?? [])}</span>
        <Button
          size="sm"
          variant={primary ? 'primary' : 'secondary'}
          icon={<IconSend />}
          loading={send.isPending}
          onClick={() => send.mutate({ featureId })}
        >
          Send to agent
        </Button>
      </div>
      {driveActive && <p className="m-0 text-xs text-text-tertiary">{DRIVE_HOLDS_THE_AGENT}</p>}
    </div>
  )
}
