import { BranchMenu, Button } from '../../ui'
import type { SessionBranchApi } from '../../lib/use-session-branch'

/**
 * The one door out of the resting project workspace (decisions.md #6).
 *
 * One heading, one line, one solid button — the card used to carry a paragraph
 * explaining what the chat would do with the idea, and the chat's own greeting
 * says that better on arrival. What is left is the door and the one argument it
 * takes: where this chat's work lands, chosen here because here is where it
 * applies (decisions.md #3). A stored pick whose branch is gone is the one
 * thing that stops a launch, and it says so on the menu rather than in a note.
 */
export function NewChatCard({
  landing,
  onStart,
  starting,
}: {
  landing: SessionBranchApi
  onStart: () => void
  starting: boolean
}) {
  return (
    <div className="flex items-center gap-6 rounded-lg border border-hairline bg-panel px-6 py-5">
      <div className="flex flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold text-text">Talk it through</h2>
        <p className="max-w-[46ch] text-sm text-text-2">
          Bring a raw idea; the chat checks it against what’s built and cuts it into features.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
          variant="solid"
          disabled={starting || landing.missing}
          title={
            landing.missing
              ? 'the branch this chat would land on is gone — pick another'
              : undefined
          }
          onClick={onStart}
        >
          {starting ? 'Opening…' : 'New chat'}
        </Button>
      </div>
    </div>
  )
}
