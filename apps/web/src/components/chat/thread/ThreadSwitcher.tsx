import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreadEntry, ThreadState } from '../../../lib/chat-thread'
import { IconCheck, IconChevronDown, IconDoc, IconPencil, IconPlus } from '../../../icons'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Spinner, StatusDot, TextField, cx } from '../../../ui'
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
  project: 'Project chat',
  prepare: 'Preparation',
}

/**
 * The header's thread list (decision 7): every thread of the feature — its main
 * chat, side threads, scenario chats — finished ones included, newest first,
 * each opening at once. "New thread" starts an empty one. A thread is only ever
 * working, waiting on you, or idle; whether a process runs behind it is not
 * the human's concern. The thread in front can be renamed and exported.
 */
export function ThreadSwitcher({
  threads,
  current,
  onPick,
  onNew,
  onRename,
  onExport,
  now,
  children,
}: {
  threads: readonly ThreadEntry[]
  current: string
  onPick: (id: string) => void
  onNew: () => void
  /** Rename the thread in front; absent, no Rename row. */
  onRename?: (title: string) => void
  /** Download the thread in front as Markdown, named by its `title`; absent, no Export row. */
  onExport?: (title: string) => void
  now?: number
  /** Rows about the thread in front, after New thread (closing a scenario errand). */
  children?: ReactNode
}) {
  const [renaming, setRenaming] = useState(false)
  const shown = threads.find((t) => t.id === current)
  const waitingElsewhere = threads.some((t) => t.state === 'waiting' && t.id !== current)
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <>
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
        <DropdownMenuContent
          align="start"
          aria-label="Threads"
          className="w-80 text-sm"
          // The rename dialog takes the focus the closing menu would hand back to its trigger.
          onCloseAutoFocus={(e) => renaming && e.preventDefault()}
        >
          <DropdownMenuItem icon={<IconPlus />} onSelect={onNew}>
            New thread
          </DropdownMenuItem>
          {shown && onRename && (
            <DropdownMenuItem icon={<IconPencil />} onSelect={() => setRenaming(true)}>
              Rename…
            </DropdownMenuItem>
          )}
          {shown && onExport && (
            <DropdownMenuItem icon={<IconDoc />} onSelect={() => onExport(shown.title)}>
              Export as Markdown
            </DropdownMenuItem>
          )}
          {children}
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
      {renaming && shown && onRename && (
        <RenameDialog
          title={shown.title}
          onClose={() => setRenaming(false)}
          onSave={(title) => {
            onRename(title)
            setRenaming(false)
          }}
        />
      )}
    </>
  )
}

/** Rename the thread: Enter saves, Escape cancels. */
function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title)
  const next = value.trim()
  const save = () => {
    if (next && next !== title) onSave(next)
    else onClose()
  }
  return (
    <Dialog open onClose={onClose} size="sm" labelledBy="rename-thread-title">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogHeader id="rename-thread-title" title="Rename thread" />
        <DialogBody>
          <TextField aria-label="Thread name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} autoFocus />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!next}>
            Rename
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
