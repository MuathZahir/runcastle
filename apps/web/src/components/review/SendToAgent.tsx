import type { TestNote } from '@runcastle/core'
import { Button } from '../../ui'
import { IconSend } from '../../icons'
import { trpc } from '../../trpc'
import type { LeadDelivery } from '../../lib/api'
import { relTimeAgo } from '../../lib/format'
import { useToast } from '../../lib/toast'

/**
 * The notes "Send to agent" would carry: the human's own, not yet sent, and not
 * frozen into a ticket — the server's `notes.send` takes exactly these.
 */
export function unsentNotes(notes: readonly TestNote[]): TestNote[] {
  return notes.filter((n) => n.author === 'human' && n.sentAt === undefined && n.status !== 'promoted')
}

/**
 * Whether a note that was sent still waits for an agent to take it
 * (`the-feature-lead-runs-rounds` decision 28): it went no earlier than the
 * oldest message the server says no agent has received yet.
 */
export function waitingForAgent(sentAt: number | undefined, delivery: LeadDelivery | undefined): boolean {
  return sentAt !== undefined && delivery?.waitingSince != null && sentAt >= delivery.waitingSince
}

/** What the line beside the button says: what is waiting, or when the last send went. */
export function sendLine(notes: readonly TestNote[], now: number = Date.now(), delivery?: LeadDelivery): string {
  const waiting = unsentNotes(notes).length
  if (waiting > 0) return `${waiting} ${waiting === 1 ? 'note' : 'notes'} not sent yet`
  const sent = notes.flatMap((n) => (n.sentAt === undefined ? [] : [n.sentAt]))
  if (sent.some((at) => waitingForAgent(at, delivery))) return 'Sent — waiting for the agent to pick it up'
  if (sent.length > 0) return `Sent ${relTimeAgo(Math.max(...sent), now)}`
  return 'No notes — sending tells the agent all is good'
}

/** Said when the agent was woken for what was sent and did not start (decision 28). */
export function wakeFailureLine(delivery: LeadDelivery | undefined): string | null {
  if (!delivery?.lastFailure) return null
  return `The agent didn’t start (its run ${delivery.lastFailure.reason}). What you sent is still queued and goes with its next start.`
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
  const delivery = trpc.notes.delivery.useQuery({ featureId })
  const failure = wakeFailureLine(delivery.data)
  const send = trpc.notes.send.useMutation({
    onSuccess: ({ sent, waiting }) => {
      void utils.notes.list.invalidate({ featureId })
      void utils.notes.delivery.invalidate({ featureId })
      const what = sent > 0 ? `${sent} ${sent === 1 ? 'note' : 'notes'}` : '“all good”'
      toast.push(
        waiting
          ? `${what} queued — the agent gets ${sent === 1 || sent === 0 ? 'it' : 'them'} as it starts`
          : sent > 0
            ? `${what} sent to the agent`
            : 'sent to the agent: all good',
        'success',
      )
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{sendLine(notes.data ?? [], Date.now(), delivery.data)}</span>
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
      {failure && <p className="m-0 text-xs text-pretty text-warning-text">{failure}</p>}
      {driveActive &&<p className="m-0 text-xs text-text-tertiary">{DRIVE_HOLDS_THE_AGENT}</p>}
    </div>
  )
}
