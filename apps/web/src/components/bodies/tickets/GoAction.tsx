import type { NextAction } from '../../../lib/feature-ui'
import { IconArrowRight } from '../../../icons'
import { BARE_BUTTON, Button, LINK, cx } from '../../../ui'

/** Go as the tickets view carries it: the action the status chose, and its one click. */
export interface GoProps {
  /** `go`, `goGated` or `goBlocked`'s action — its `disabled` is the reason, its `escape` the override. */
  action: NextAction
  busy: boolean
  /** Opens Go's confirmation — the override too, which asks for its reason there. */
  onGo: () => void
}

/**
 * Go on the tickets view (design-mode decision 12), above the list, since it
 * starts the burn of what is listed: the page's one primary. Gated, it is
 * disabled with the reason beneath it; when the reason has a way past — the
 * plan is not finished — a small "Go anyway…" link under the reason opens the
 * same confirmation, which asks why. Uncommitted design work has no way past.
 */
export function GoAction({ action, busy, onGo }: GoProps) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <Button
        variant="primary"
        icon={<IconArrowRight />}
        disabled={busy || !!action.disabled}
        title={action.disabled ?? action.hint}
        onClick={onGo}
      >
        {busy ? 'Working…' : action.label}
      </Button>
      {action.disabled && <p className="m-0 text-xs text-text-tertiary">{action.disabled}</p>}
      {action.disabled && action.escape && (
        <button type="button" className={cx(BARE_BUTTON, LINK, 'p-0 text-xs')} disabled={busy} onClick={onGo}>
          {action.escape.label}
        </button>
      )}
    </div>
  )
}
