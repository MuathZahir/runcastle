import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import { relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { splitDriveNotes } from '../../lib/project-drive'
import { uploadProjectNoteScreenshot } from '../../lib/project-notes'
import { imageOnClipboard, toPngBlob } from '../../lib/reviews'
import { shortcut } from '../../lib/platform'
import { useToast } from '../../lib/toast'
import { IconX } from '../../icons'
import { Aside, IconButton, Kbd, NoteThumbnail, SectionLabel, TextField } from '../../ui'
import { Lightbox } from '../review/Lightbox'
import { DriveTag, NoteDot, NoteRow } from './NoteRow'

/**
 * The project's notes inbox beside a project drive, live
 * (project-level-test-drive decision 4): the notes taken since the drive
 * started first, then the ones that were already open — so a driver sees what
 * is already reported — and a composer at the bottom.
 *
 * It is the same inbox the Notes card reads, not a second notes surface: every
 * door here writes an ordinary project note, and the server stamps the drive's
 * branch and commit onto it (decision 5).
 */
export function ProjectNotesRail({
  projectId,
  startedAt,
  onClose,
}: {
  projectId: string
  /** When the live drive started — the "this drive" boundary. */
  startedAt: number | undefined
  /** Fold the aside away; the drive's topbar toggle brings it back. */
  onClose: () => void
}) {
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const [picture, setPicture] = useState<string | null>(null)
  const { thisDrive, alreadyOpen } = splitDriveNotes(notesQ.data ?? [], startedAt)
  const count = thisDrive.length + alreadyOpen.length

  return (
    <Aside
      title="Notes"
      actions={
        count > 0 ? (
          <span className="pr-1 text-xs text-text-tertiary tabular-nums" title={`${count} open`}>
            {count} open
          </span>
        ) : undefined
      }
      onClose={onClose}
      bodyClassName="flex flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <Group title="This drive">
            {thisDrive.length === 0 ? (
              <EmptyRow>Nothing yet. Select an area of the app, or type below.</EmptyRow>
            ) : (
              thisDrive.map((note) => <RailNote key={note.id} note={note} onOpen={setPicture} />)
            )}
          </Group>
          <Group title="Already open">
            {alreadyOpen.length === 0 ? (
              <EmptyRow>No other open notes.</EmptyRow>
            ) : (
              alreadyOpen.map((note) => <RailNote key={note.id} note={note} onOpen={setPicture} />)
            )}
          </Group>
        </div>

        <RailComposer projectId={projectId} />
      </div>
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </Aside>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="pt-2">
      <SectionLabel className="px-4">{title}</SectionLabel>
      <ul className="m-0 flex list-none flex-col px-1 py-0">{children}</ul>
    </section>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-3 py-1.5 text-sm text-text-tertiary">{children}</li>
}

function RailNote({ note, onOpen }: { note: ProjectNote; onOpen: (url: string) => void }) {
  return (
    <NoteRow
      lead={
        note.screenshotUrl ? (
          <NoteThumbnail size="sm" url={note.screenshotUrl} onOpen={onOpen} />
        ) : (
          <NoteDot />
        )
      }
      when={relTime(note.createdAt)}
    >
      <span className="text-text">{note.text}</span>
      <DriveTag note={note} />
    </NoteRow>
  )
}

/**
 * One line, Enter saves; a pasted image rides along as the note's screenshot —
 * the capture popover's arrangement (`NoteCapture`), in the rail.
 */
function RailComposer({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const add = trpc.projectNotes.add.useMutation()
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<{ png: Blob; preview: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Whoever replaces or clears the staged picture releases the URL it displaced.
  useEffect(() => () => URL.revokeObjectURL(staged?.preview ?? ''), [staged])

  const onPaste = (e: ClipboardEvent<HTMLElement>): void => {
    const image = imageOnClipboard(e.clipboardData)
    if (!image) return
    e.preventDefault()
    toPngBlob(image)
      .then((png) => setStaged({ png, preview: URL.createObjectURL(png) }))
      .catch((err: unknown) =>
        toast.push(err instanceof Error ? err.message : 'that image could not be read'),
      )
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      // Note first, PNG second — the upload is keyed by the id the server minted.
      const note = await add.mutateAsync({ projectId, text })
      if (staged) {
        try {
          await uploadProjectNoteScreenshot(note.id, staged.png)
        } catch (e) {
          toast.push(
            `the note was saved, but its picture was not: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      void utils.projectNotes.invalidate()
      setText('')
      setStaged(null)
      inputRef.current?.focus()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the note could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle p-3" onPaste={onPaste}>
      <TextField
        ref={inputRef}
        autoComplete="off"
        aria-label="New note"
        placeholder="What did you just notice?"
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          void submit()
        }}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
        {staged ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-surface-hover pr-0.5 pl-1 text-text-secondary animate-pop-in">
            <img
              src={staged.preview}
              alt="the picture this note will carry"
              className="h-4 w-6 rounded-sm bg-surface-inset object-cover"
            />
            Screenshot
            <IconButton
              size="sm"
              label="Remove the picture"
              icon={<IconX />}
              onClick={() => setStaged(null)}
            />
          </span>
        ) : (
          <span>Paste a screenshot</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Kbd>↵</Kbd> save
        </span>
        <span className="flex items-center gap-1">
          <Kbd>{shortcut('J')}</Kbd> anywhere
        </span>
      </div>
    </div>
  )
}
