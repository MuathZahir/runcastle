import { useState } from 'react'
import { IconMessage, IconPencil, IconPlus } from '../../icons'
import { relTimeAgo } from '../../lib/format'
import { useLiveStatus } from '../../lib/live'
import type { ProjectNavApi } from '../../lib/use-project-nav'
import { IconButton, Sheet, SheetRow, StatusDot } from '../../ui'
import { ProjectSwitcher } from '../ProjectSwitcher'

/**
 * The phone list's head (docs/features/runcastle-on-your-phone decision 7):
 * the project switcher, and a "+" whose sheet holds the two things worth doing
 * with a thumb — a new Orchestrator chat and a note. Adding to the backlog is
 * asked of the Orchestrator in chat.
 */
export function PhoneListHead({
  nav,
  onNewChat,
  onOpenNote,
}: {
  nav: ProjectNavApi
  onNewChat: () => void
  onOpenNote?: () => void
}) {
  const [creating, setCreating] = useState(false)
  const pick = (act: () => void) => () => {
    setCreating(false)
    act()
  }
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-1">
      <div className="flex min-w-0 flex-1">
        <ProjectSwitcher nav={nav} />
      </div>
      <IconButton label="New" size="lg" icon={<IconPlus />} onClick={() => setCreating(true)} />
      <Sheet open={creating} onClose={() => setCreating(false)} label="New">
        <SheetRow icon={<IconMessage />} label="New chat" hint="A new chat with the orchestrator — talk an idea through before it becomes a feature" onClick={pick(onNewChat)} />
        {onOpenNote && (
          <SheetRow icon={<IconPencil />} label="Jot a note" hint="What you just noticed — triage it later" onClick={pick(onOpenNote)} />
        )}
      </Sheet>
    </div>
  )
}

/**
 * The list's warning while the computer cannot be reached (decision 9): the
 * live stream is down or the list's own read failed. It says how old the list
 * is, and goes by itself once the computer answers again. It shows only while
 * the app is open — a fresh open with the computer off is the browser's error.
 */
export function ComputerUnreachable({ failed, readAt }: { failed: boolean; readAt: number }) {
  const offline = useLiveStatus() === 'offline' || failed
  if (!offline) return null
  return (
    <div role="status" className="mx-1 mt-1 flex items-start gap-2.5 rounded-lg bg-danger-subtle px-3 py-2.5">
      <span className="mt-1.5">
        <StatusDot tone="danger" />
      </span>
      <span className="min-w-0 text-sm text-text">
        Can’t reach your computer. It may be asleep, or Tailscale is off on this phone.
        {readAt > 0 && ` This list is from ${relTimeAgo(readAt)}.`}
      </span>
    </div>
  )
}
