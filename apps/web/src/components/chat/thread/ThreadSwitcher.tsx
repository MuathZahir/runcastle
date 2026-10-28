import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreadEntry } from '../../../lib/chat-thread'
import { IconCheck, IconChevronDown, IconDoc, IconPencil, IconPlus } from '../../../icons'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, StatusDot, TextField, cx } from '../../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu'
import { SELECT_GHOST } from '../../../ui/select'
import { ThreadStateMark, threadStateWords } from './ThreadState'

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
          {shown && <ThreadStateMark state={shown.state} />}
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
                  <ThreadStateMark state={t.state} />
                </span>
                {/* Its state, never its kind (decision 14); empty, and so no height, for an idle thread with no time. */}
                <span className="text-xs text-text-tertiary empty:hidden">{threadStateWords(t.state, t.updatedAt, now)}</span>
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
