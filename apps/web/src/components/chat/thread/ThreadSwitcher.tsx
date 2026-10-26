import type { ThreadEntry, ThreadState } from '../../../lib/chat-thread'
import { IconCheck, IconChevronDown, IconPlus } from '../../../icons'
import { Spinner, StatusDot, cx } from '../../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu'
import { SELECT_GHOST } from '../../../ui/select'

/** "now", "4m", "3h", "2d". */
export function ago(at: number, now = Date.now()): string {
  const m = Math.round((now - at) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

/** A thread's state as its mark: a spinner while it works, a dot while it waits on you, nothing idle. */
function StateMark({ state }: { state: ThreadState }) {
  if (state === 'working') return <Spinner size="sm" />
  if (state === 'waiting') return <StatusDot tone="warning" label="Waiting for you" />
  return null
}

const ROLE_LABEL: Record<ThreadEntry['role'], string> = {
  main: 'Feature chat',
  side: 'Thread',
  scenario: 'Scenario chat',
}

/**
 * The header's thread list (decision 7): every thread of the feature — its main
 * chat, side threads, scenario chats — finished ones included, newest first,
 * each opening at once. "New thread" starts an empty one. A thread is only ever
 * working, waiting on you, or idle; whether a process runs behind it is not
 * the human's concern.
 */
export function ThreadSwitcher({
  threads,
  current,
  onPick,
  onNew,
  now,
}: {
  threads: readonly ThreadEntry[]
  current: string
  onPick: (id: string) => void
  onNew: () => void
  now?: number
}) {
  const shown = threads.find((t) => t.id === current)
  const waitingElsewhere = threads.some((t) => t.state === 'waiting' && t.id !== current)
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Thread"
        className={cx(SELECT_GHOST, 'inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-sm font-medium text-text')}
      >
        {shown && <StateMark state={shown.state} />}
        <span className="min-w-0 truncate">{shown?.title}</span>
        {waitingElsewhere && <StatusDot tone="warning" label="Another thread is waiting for you" />}
        <IconChevronDown size={14} className="shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Threads" className="w-80 text-sm">
        <DropdownMenuItem icon={<IconPlus />} onSelect={onNew}>
          New thread
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Threads</DropdownMenuLabel>
        {sorted.map((t) => (
          <DropdownMenuItem
            key={t.id}
            role="menuitemradio"
            aria-checked={t.id === current}
            icon={t.id === current ? <IconCheck /> : <span className="size-4 shrink-0" />}
            onSelect={() => onPick(t.id)}
          >
            <span className="flex min-w-0 flex-1 flex-col py-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{t.title}</span>
                <StateMark state={t.state} />
              </span>
              <span className="text-xs text-text-tertiary">
                {ROLE_LABEL[t.role]} · {t.state === 'waiting' ? 'waiting for you' : t.state === 'working' ? 'working' : ago(t.updatedAt, now)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
