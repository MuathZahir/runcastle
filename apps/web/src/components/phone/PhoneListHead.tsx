import { useState } from 'react'
import { IconList, IconPencil, IconPlus } from '../../icons'
import { relTimeAgo } from '../../lib/format'
import { useLiveStatus } from '../../lib/live'
import type { ProjectNavApi } from '../../lib/use-project-nav'
import { IconButton, Sheet, SheetRow, StatusDot } from '../../ui'
import { PhoneRail } from '../ProjectRail'
import { SidebarHead } from '../SidebarParts'
import { useOpenGlossary } from '../GlossaryDialog'

/**
 * The phone list's head (docs/features/runcastle-on-your-phone decision 7):
 * the project rail's row of tiles (one tap switches), the project's name, and
 * a "+" whose sheet holds a note and the Glossary, which the phone has no help
 * menu for. Adding to the backlog is asked of the Orchestrator in chat. A new
 * epic starts from the list's dotted slot (epics-that-look-alive decision 5),
 * not from here.
 */
export function PhoneListHead({
  nav,
  onOpenNote,
}: {
  nav: ProjectNavApi
  onOpenNote?: () => void
}) {
  const [creating, setCreating] = useState(false)
  const openGlossary = useOpenGlossary()
  const pick = (act: () => void) => () => {
    setCreating(false)
    act()
  }
  return (
    <>
      <PhoneRail />
      <SidebarHead name={nav.currentProject?.name} phone>
        <IconButton label="New" size="lg" icon={<IconPlus />} onClick={() => setCreating(true)} />
        <Sheet open={creating} onClose={() => setCreating(false)} label="New">
          {onOpenNote && (
            <SheetRow icon={<IconPencil />} label="Jot a note" hint="What you just noticed — triage it later" onClick={pick(onOpenNote)} />
          )}
          {openGlossary && (
            <SheetRow icon={<IconList />} label="Glossary" hint="The words runcastle uses, in one sentence each" onClick={pick(() => openGlossary())} />
          )}
        </Sheet>
      </SidebarHead>
    </>
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
