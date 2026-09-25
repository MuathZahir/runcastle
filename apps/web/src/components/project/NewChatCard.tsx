import { IconMessage, IconPlus, IconRefresh, IconSparkle } from '../../icons'
import { BranchMenu, Button } from '../../ui'
import type { SessionBranchApi } from '../../lib/use-session-branch'
import { ActionRow } from './ActionRow'

/**
 * The one door out of the resting project workspace (decisions.md #6).
 *
 * One title, one line, the page's one primary button — the row used to carry a
 * paragraph explaining what the chat would do with the idea, and the chat's own
 * greeting says that better on arrival. What is left is the door and the one
 * argument it takes: where this chat's work lands, chosen here because here is
 * where it applies (decisions.md #3). A stored pick whose branch is gone is the
 * one thing that stops a launch, and it says so on the menu rather than in a
 * note.
 */
export function NewChatCard({
  landing,
  onStart,
  starting,
  openSession,
}: {
  landing: SessionBranchApi
  onStart: () => void
  starting: boolean
  openSession?: { onOpen: () => void; onReplace: () => void }
}) {
  return (
    <ActionRow
      icon={<IconSparkle />}
      title="Talk it through"
      hint="Bring a raw idea; the chat checks it against what’s built and cuts it into features."
      actions={
        <>
          <BranchMenu
            prefix="landing on"
            value={landing.value}
            branches={landing.branches}
            detected={landing.detected}
            missing={landing.missing}
            disabled={landing.picking}
            onPick={landing.pick}
          />
          <Button
            variant="primary"
            icon={<IconPlus />}
            loading={starting}
            disabled={starting || landing.missing}
            title={
              landing.missing
                ? 'the branch this chat would land on is gone — pick another'
                : undefined
            }
            onClick={onStart}
          >
            New chat
          </Button>
        </>
      }
      caption={landing.missing ? 'The landing branch is gone — pick another.' : undefined}
    >
      {openSession && (
        // One live chat per project: the choice is made here, in place, rather
        // than in a dialog. A line, not a box — the row is the frame.
        <div
          role="status"
          className="mt-3 ml-12 flex flex-wrap items-center gap-2 animate-rise-in"
        >
          <span className="mr-auto text-sm text-text-secondary">A chat is already open.</span>
          <Button variant="ghost" size="sm" icon={<IconMessage />} onClick={openSession.onOpen}>
            Open it
          </Button>
          <Button
            size="sm"
            icon={<IconRefresh />}
            loading={starting}
            disabled={starting}
            onClick={openSession.onReplace}
          >
            End it and start new
          </Button>
        </div>
      )}
    </ActionRow>
  )
}
