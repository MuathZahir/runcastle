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
import { Kbd, NoteThumbnail } from '../../ui'
import { Lightbox } from '../review/Lightbox'
import { DriveTag, NoteRow } from './NoteRow'

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
}: {
  projectId: string
  /** When the live drive started — the "this drive" boundary. */
  startedAt: number | undefined
}) {
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const [picture, setPicture] = useState<string | null>(null)
  const { thisDrive, alreadyOpen } = splitDriveNotes(notesQ.data ?? [], startedAt)
  const count = thisDrive.length + alreadyOpen.length

  return (
    <aside
      aria-label="Project notes"
      className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-hairline bg-panel-2"
    >
      <div className="flex items-center gap-2.5 py-3 pr-3 pl-3.5">
        <h3 className="m-0 text-base font-semibold text-text">Notes</h3>
        {count > 0 && (
          <span
            className="inline-grid h-4.5 min-w-4.5 place-items-center rounded-pill border border-accent-line bg-accent-soft px-1.5 text-xs font-semibold text-accent-hi tabular-nums"
            title={`${count} open`}
          >
            {count}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-text-3">to the project’s inbox</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </aside>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h4 className="m-0 px-3.5 pt-2.5 pb-1 text-xs font-semibold tracking-[0.1em] text-text-3 uppercase">
        {title}
      </h4>
      <ul className="m-0 list-none py-1 pl-0">{children}</ul>
    </section>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-3.5 py-1.5 text-sm text-text-3">{children}</li>
}

function RailNote({ note, onOpen }: { note: ProjectNote; onOpen: (url: string) => void }) {
  return (
    <NoteRow
      className="py-1.5 pr-2.5 pl-3.5"
      lead={
        note.screenshotUrl ? (
          <NoteThumbnail size="sm" url={note.screenshotUrl} onOpen={onOpen} />
        ) : (
          <span className="grid w-10 place-items-center" aria-hidden>
            <i className="size-1.25 rounded-pill bg-accent-line" />
          </span>
        )
      }
      when={relTime(note.createdAt)}
    >
      <span className="text-sm text-text">{note.text}</span>
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
    <div
      className="flex flex-col gap-1.5 border-t border-hairline bg-panel p-2.5"
      onPaste={onPaste}
    >
      <input
        ref={inputRef}
        className="h-8 min-w-0 rounded-sm border border-hairline bg-panel-inset px-2.5 font-sans text-sm text-text outline-none placeholder:text-text-4 focus:border-accent-line"
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
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-text-3">
        {staged ? (
          <span className="inline-flex h-5 items-center gap-1.5 rounded-sm border border-hairline-strong bg-panel-3 pr-0.5 pl-0.5 text-text-2">
            <img
              src={staged.preview}
              alt="the picture this note will carry"
              className="h-4 w-6 rounded-[3px] bg-black object-cover"
            />
            Screenshot
            <button
              type="button"
              className="flex size-4 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 hover:bg-hairline"
              aria-label="remove the picture"
              title="Remove the picture"
              onClick={() => setStaged(null)}
            >
              <span className="flex items-center text-text-3">
                <IconX size={10} />
              </span>
            </button>
          </span>
        ) : (
          <span>paste a screenshot</span>
        )}
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> save
        </span>
        <span className="flex items-center gap-1">
          <Kbd>{shortcut('J')}</Kbd> works too
        </span>
      </div>
    </div>
  )
}
