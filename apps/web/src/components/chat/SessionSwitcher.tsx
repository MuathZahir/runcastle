import type { ReactNode } from 'react'
import type { ChatSessionEntry } from '../../lib/chat-sessions'
import { IconCheck, IconChevronDown } from '../../icons'
import { StatusDot, cx } from '../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu'
import { SELECT_GHOST } from '../../ui/select'

/**
 * The chat column's session switcher (design-mode decisions 9, 12), in the
 * page's one header row: the conversation on show, and the others the column
 * can show instead. Picking one only changes which is in front — every live
 * terminal stays mounted behind it.
 *
 * Its menu also holds what the chat's own header row used to: `children`, the
 * actions on the conversation in front (End session, closing an errand), and
 * `hint`, one quiet line about it ("Plans the feature · the lead after Go").
 */
export function SessionSwitcher({
  entries,
  current,
  onPick,
  hint,
  children,
}: {
  entries: readonly ChatSessionEntry[]
  current: string
  onPick: (id: string) => void
  hint?: ReactNode
  children?: ReactNode
}) {
  const shown = entries.find((e) => e.id === current)
  // A side session the human is NOT looking at waits on them; the one in view
  // needs no dot to say so (several-sessions-per-feature decision 12).
  const waitingElsewhere = entries.some((e) => e.waiting && e.id !== current)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Chat session"
        className={cx(
          SELECT_GHOST,
          'inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-sm font-medium text-text',
        )}
      >
        {shown?.live && <StatusDot tone="live" label="Live" />}
        <span className="min-w-0 truncate">{shown?.label}</span>
        {waitingElsewhere && <StatusDot tone="warning" label="A side session is waiting" />}
        <IconChevronDown size={14} className="shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Chat session" className="max-w-80 text-sm">
        {entries.map((e) => (
          <DropdownMenuItem
            key={e.id}
            // One of a set, the current one checked: a picker's rows among the menu's actions.
            role="menuitemradio"
            aria-checked={e.id === current}
            icon={e.id === current ? <IconCheck /> : <span className="size-4 shrink-0" />}
            onSelect={() => onPick(e.id)}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {e.waiting ? <StatusDot tone="warning" label="Waiting" /> : e.live && <StatusDot tone="live" />}
              <span className="truncate">{e.label}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {(children || hint) && <DropdownMenuSeparator />}
        {children}
        {hint && <p className="m-0 px-2 pt-1.5 pb-1 text-xs text-text-tertiary">{hint}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
