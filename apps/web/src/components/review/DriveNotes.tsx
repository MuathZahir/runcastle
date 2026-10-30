import { useRef, useState, type ReactNode } from 'react'
import { Button, Disclosure, IconButton, SectionLabel, TextArea, cx } from '../../ui'
import { IconImage, IconInbox, IconPencil, IconSend, IconTrash } from '../../icons'

/**
 * The notes beside a test drive (test-drive-looks-the-part decisions 14, 15):
 * one list for the feature's drive and the Orchestrator's, whichever store the
 * notes live in. Hook-free: a note arrives as plain props and every change
 * leaves as a callback, so the two drives wire it to their own API.
 *
 * Evidence first: a note's picture runs the rail's full width, so it reads
 * without opening it, and the words sit under it at the row size. New notes
 * land at the bottom, next to the box they were typed in. Edit and Delete are
 * in the row and always there, quiet until the pointer or focus is on the note.
 */
export interface DriveNote {
  id: string
  text: string
  picture?: string
  /** "4m", "now": the note's age. */
  when: string
  /** Who wrote it, when it was not the human ("Review agent"). */
  by?: string
}

export interface DriveNoteActions {
  onOpenPicture: (url: string) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  /** Attach or replace the note's one picture. */
  onPicture: (id: string, file: File) => void
}

function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-50 transition-opacity duration-(--dur-1) group-focus-within/note:opacity-100 group-hover/note:opacity-100">
      <IconButton size="sm" label="Edit note" icon={<IconPencil />} onClick={onEdit} />
      <IconButton size="sm" label="Delete note" icon={<IconTrash />} variant="danger-ghost" onClick={onDelete} />
    </span>
  )
}

/** The words changed in place, the picture left in view: Enter saves, Esc cancels. */
function NoteEditor({
  note,
  onPicture,
  onSave,
  onCancel,
}: {
  note: DriveNote
  onPicture: (file: File) => void
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(note.text)
  const picker = useRef<HTMLInputElement>(null)
  const save = () => {
    if (text.trim()) onSave(text.trim())
  }
  return (
    <div className="flex flex-col gap-2">
      <TextArea
        rows={3}
        aria-label="Edit note"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
      />
      <div className="flex items-center gap-1">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPicture(file)
            e.target.value = ''
          }}
        />
        <Button size="sm" variant="ghost" icon={<IconImage />} onClick={() => picker.current?.click()}>
          {note.picture ? 'Replace picture' : 'Add picture'}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!text.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** One note. `readonly` for a note already sent: the record, nothing to change. */
export function DriveNoteRow({
  note,
  readonly = false,
  ...actions
}: DriveNoteActions & { note: DriveNote; readonly?: boolean }) {
  const [mode, setMode] = useState<'rest' | 'edit' | 'delete'>('rest')
  return (
    <li className="group/note m-0 flex list-none flex-col gap-2 px-4 py-3 animate-rise-in">
      {note.picture && (
        <button
          type="button"
          aria-label="Open the picture"
          onClick={() => actions.onOpenPicture(note.picture ?? '')}
          className="block w-full cursor-zoom-in overflow-hidden rounded-md border-0 bg-surface-inset p-0"
        >
          <img src={note.picture} alt="" className="block max-h-44 w-full object-cover object-top" />
        </button>
      )}
      {mode === 'edit' ? (
        <NoteEditor
          note={note}
          onPicture={(file) => actions.onPicture(note.id, file)}
          onCancel={() => setMode('rest')}
          onSave={(text) => {
            actions.onEdit(note.id, text)
            setMode('rest')
          }}
        />
      ) : (
        <>
          <p className={cx('m-0 text-md text-pretty whitespace-pre-wrap', readonly ? 'text-text-secondary' : 'text-text')}>
            {note.text}
          </p>
          <div className="flex h-6 items-center gap-2 text-xs text-text-tertiary">
            {mode === 'delete' ? (
              <>
                <span className="min-w-0 flex-1 truncate">Delete this note{note.picture ? ' and its picture' : ''}?</span>
                <Button size="sm" variant="ghost" onClick={() => setMode('rest')}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" onClick={() => actions.onDelete(note.id)}>
                  Delete
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">
                  {note.by ? `${note.by} · ` : ''}
                  {note.when}
                </span>
                {!readonly && <Actions onEdit={() => setMode('edit')} onDelete={() => setMode('delete')} />}
              </>
            )}
          </div>
        </>
      )}
    </li>
  )
}

const DIVIDED = 'm-0 flex flex-col divide-y divide-border-subtle p-0'

/**
 * The rail's list. `notes` are the ones still open; `earlier` is a titled group
 * above them (the Orchestrator's notes from before this drive); `sent` folds
 * away what has already gone to the agent. `foot` is what the rail ends in: the
 * Send line and the note box, pinned under the scroller.
 */
export function DriveNotes({
  notes,
  earlier,
  sent = [],
  foot,
  ...actions
}: DriveNoteActions & {
  notes: DriveNote[]
  earlier?: { title: string; notes: DriveNote[] }
  sent?: DriveNote[]
  foot: ReactNode
}) {
  const nothing = notes.length === 0 && sent.length === 0 && !earlier?.notes.length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        {sent.length > 0 && (
          <div className="px-4 pt-2">
            <Disclosure size="sm" title={`${sent.length} sent to the agent`}>
              <ul className={cx(DIVIDED, '-mx-4')}>
                {sent.map((n) => (
                  <DriveNoteRow key={n.id} note={n} readonly {...actions} />
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
        {earlier && earlier.notes.length > 0 && (
          <section aria-label={earlier.title}>
            <SectionLabel className="px-4 pt-3">{earlier.title}</SectionLabel>
            <ul className={DIVIDED}>
              {earlier.notes.map((n) => (
                <DriveNoteRow key={n.id} note={n} {...actions} />
              ))}
            </ul>
          </section>
        )}
        {nothing ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <IconInbox size={20} className="text-icon" />
            <p className="m-0 text-md font-medium text-text">Nothing noted yet</p>
            <p className="m-0 text-sm text-pretty text-text-tertiary">
              Select an area of the app, paste a screenshot, or just type.
            </p>
          </div>
        ) : (
          <section aria-label="This drive">
            {!!earlier?.notes.length && <SectionLabel className="px-4 pt-3">This drive</SectionLabel>}
            <ul className={DIVIDED}>
              {notes.map((n) => (
                <DriveNoteRow key={n.id} note={n} {...actions} />
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 p-3">{foot}</div>
    </div>
  )
}

/**
 * The line above the note box on a feature's drive: what is waiting and the one
 * way to send it. Nothing at all with no notes: a drive with nothing to say
 * sends nothing (decision 16).
 */
export function SendNotesLine({ count, onSend }: { count: number; onSend: () => void }) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
        {count} {count === 1 ? 'note' : 'notes'} ready
      </span>
      <Button size="sm" variant="primary" icon={<IconSend />} onClick={onSend}>
        Send to the agent
      </Button>
    </div>
  )
}
