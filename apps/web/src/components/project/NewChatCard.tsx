import { IconPlus, IconSparkle } from '../../icons'
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
}: {
  landing: SessionBranchApi
  /** Opens a new empty thread, whatever else is running (chat-as-web-components decision 14). */
  onStart: () => void
  starting: boolean
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
    />
  )
}
