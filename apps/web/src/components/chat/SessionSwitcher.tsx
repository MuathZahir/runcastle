import type { ChatSessionEntry } from '../../lib/chat-sessions'
import { StatusDot, cx } from '../../ui'
import { SELECT_GHOST, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'

/**
 * The chat column's session switcher (design-mode decision 9), in the chat
 * strip where its context line was: the conversation on show, and the others
 * the column can show instead. Picking one only changes which is in front —
 * every live terminal stays mounted behind it.
 */
export function SessionSwitcher({
  entries,
  current,
  onPick,
}: {
  entries: readonly ChatSessionEntry[]
  current: string
  onPick: (id: string) => void
}) {
  const shown = entries.find((e) => e.id === current)
  return (
    <Select value={current} onValueChange={onPick}>
      <SelectTrigger aria-label="Chat session" className={cx(SELECT_GHOST, 'min-w-0 text-sm font-medium text-text')}>
        <SelectValue>{shown?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" aria-label="Chat session">
        {entries.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            <span className="inline-flex items-center gap-2">
              {e.live && <StatusDot tone="live" />}
              {e.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
