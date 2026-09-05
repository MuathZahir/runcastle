import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react'
import type { TestNote } from '@runcastle/core'
import { Button, Dialog } from '../../ui'
import { trpc } from '../../trpc'
import { toPngBlob, uploadScreenshot } from '../../lib/reviews'
import { saveAnnotatedNote } from '../../lib/walkthrough'
import { useToast } from '../../lib/toast'

/**
 * Writing a note, and changing one (decisions 7a, 24d, 25d–g).
 *
 * A self-testing human is the case the walked inbox never served: only a video
 * annotation could carry a picture, so someone clicking through the app
 * themselves had nothing to attach to "this button is in the wrong place". Both
 * surfaces here take a pasted or attached image and ride it onto the SAME
 * note-screenshot pipeline a baked annotation uses — note first, PNG second —
 * so a hand note's screenshot reaches triage, the thumbnail and the promoted
 * ticket's attachment exactly as an annotation's does.
 *
 * One image per note (decision 25g): the PNG is keyed by note id on disk, so a
 * second picture would overwrite the first. Pasting over one therefore asks
 * first, and "many pictures" is spelled as many notes.
 *
 * The field is a textarea, Enter saves and Shift+Enter breaks the line — the
 * walked single-line input fired on the first Enter of a two-sentence note.
 */

/** The one image a note may carry, staged before it has anywhere to go. */
interface StagedImage {
  png: Blob
  /** An object URL for the preview, revoked when the staging is dropped. */
  preview: string
}

/**
 * The image on the clipboard, or null. Files first — that is where a screenshot
 * pasted from the OS lands — then the items list, which is where some browsers
 * put an image copied out of another page.
 */
function imageOnClipboard(data: DataTransfer | null): Blob | null {
  if (!data) return null
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith('image/')) return file
  }
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

/** Stage a picture for a note, converting whatever was pasted into PNG bytes. */
function useStagedImage(): {
  staged: StagedImage | null
  stage: (image: Blob) => Promise<void>
  drop: () => void
} {
  const toast = useToast()
  const [staged, setStaged] = useState<StagedImage | null>(null)
  // Revoke on unmount only: `stage` and `drop` revoke the URL they replace, so
  // keying the cleanup on `staged` would revoke the one the render just used.
  const live = useRef<string | null>(null)
  useEffect(() => {
    live.current = staged?.preview ?? null
  }, [staged])
  useEffect(() => () => {
    if (live.current) URL.revokeObjectURL(live.current)
  }, [])

  const drop = (): void => {
    setStaged((current) => {
      if (current) URL.revokeObjectURL(current.preview)
      return null
    })
  }

  const stage = async (image: Blob): Promise<void> => {
    try {
      const png = await toPngBlob(image)
      const next = { png, preview: URL.createObjectURL(png) }
      setStaged((current) => {
        if (current) URL.revokeObjectURL(current.preview)
        return next
      })
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'that image could not be read')
    }
  }

  return { staged, stage, drop }
}

/** The preview of a staged picture, with the one control it needs. */
function StagedPreview({ preview, onDrop }: { preview: string; onDrop: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <img
        src={preview}
        alt="the picture this note will carry"
        className="h-[54px] w-24 rounded-sm border border-hairline bg-black object-cover"
      />
      <Button className="px-2" onClick={onDrop}>
        Remove picture
      </Button>
    </div>
  )
}

/** Attach a file from disk — the other half of paste, for a saved screenshot. */
function AttachButton({ onPick }: { onPick: (image: Blob) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="attach an image"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          // So the same file picked twice in a row still fires a change.
          e.target.value = ''
        }}
      />
      <Button className="px-2" onClick={() => input.current?.click()}>
        Attach image
      </Button>
    </>
  )
}

const NOTE_TEXTAREA =
  'min-h-16 w-full resize-y rounded-md border border-hairline bg-panel-inset px-3 py-2 ' +
  'font-mono text-sm text-text placeholder:text-text-4 focus:border-accent-line focus:outline-none'

/**
 * The capture box: what did you just see, and a picture of it.
 *
 * Deliberately not gated on an active drive — observations do not stop when the
 * dev server does, and the "one more thing" typed right after Stop would be lost
 * if the box only existed while a drive was live.
 */
export function NoteComposer({ featureId }: { featureId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const { staged, stage, drop } = useStagedImage()
  // A picture is already staged and another arrived: one image per note, so ask
  // before the first one is thrown away (decision 25g).
  const [replacing, setReplacing] = useState<Blob | null>(null)

  const add = trpc.notes.add.useMutation()

  const take = (image: Blob): void => {
    if (staged) setReplacing(image)
    else void stage(image)
  }

  const onPaste = (e: ReactClipboardEvent<HTMLElement>): void => {
    const image = imageOnClipboard(e.clipboardData)
    if (!image) return
    e.preventDefault()
    take(image)
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      const png = staged?.png
      const saved = await saveAnnotatedNote({
        createNote: () => add.mutateAsync({ featureId, text }),
        // A note with no picture is the ordinary case and uploads nothing.
        uploadScreenshot: async (noteId) => {
          if (png) await uploadScreenshot(noteId, png)
        },
      })
      if (saved.uploadError) {
        toast.push(`the note was saved, but its picture was not: ${saved.uploadError}`)
      }
      setText('')
      drop()
      void utils.notes.list.invalidate({ featureId })
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the note could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" onPaste={onPaste}>
      <textarea
        aria-label="what did you just see?"
        className={NOTE_TEXTAREA}
        placeholder="What did you just see? Paste a screenshot straight in. (Enter saves, Shift+Enter for a new line)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          void submit()
        }}
      />
      {staged && <StagedPreview preview={staged.preview} onDrop={drop} />}
      <div className="flex items-center gap-2">
        <Button variant="solid" disabled={!text.trim() || saving} onClick={() => void submit()}>
          {saving ? 'Adding…' : 'Add'}
        </Button>
        <AttachButton onPick={take} />
      </div>

      <ReplaceImageDialog
        open={!!replacing}
        onKeep={() => setReplacing(null)}
        onReplace={() => {
          const image = replacing
          setReplacing(null)
          if (image) void stage(image)
        }}
      />
    </div>
  )
}

/**
 * One note's text and picture, changed in place (decision 25d).
 *
 * Rendered into {@link NoteRow}'s editor slot, so the thumbnail and the
 * timestamp of the thing being edited stay on screen the whole time — the walked
 * editor replaced the row with a bare input and hid the evidence at exactly the
 * moment the human was rewriting the words about it.
 */
export function NoteEditor({ note, onDone }: { note: TestNote; onDone: () => void }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [text, setText] = useState(note.text)
  const [attaching, setAttaching] = useState(false)
  // The note may already have a picture on disk, which is the same one-per-note
  // question the composer asks about a staged one.
  const [replacing, setReplacing] = useState<Blob | null>(null)

  const refresh = (): void => void utils.notes.list.invalidate({ featureId: note.featureId })
  const edit = trpc.notes.edit.useMutation({
    onSuccess: () => {
      refresh()
      onDone()
    },
    onError: (e) => toast.push(e.message),
  })

  const save = (): void => {
    if (text.trim() && !edit.isPending) edit.mutate({ noteId: note.id, text })
  }

  const attach = async (image: Blob): Promise<void> => {
    setAttaching(true)
    try {
      await uploadScreenshot(note.id, await toPngBlob(image))
      refresh()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'that picture could not be attached')
    } finally {
      setAttaching(false)
    }
  }

  const take = (image: Blob): void => {
    if (note.screenshotUrl) setReplacing(image)
    else void attach(image)
  }

  return (
    <div
      className="flex flex-col gap-2"
      onPaste={(e) => {
        const image = imageOnClipboard(e.clipboardData)
        if (!image) return
        e.preventDefault()
        take(image)
      }}
    >
      <textarea
        aria-label="edit this note"
        className={NOTE_TEXTAREA}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
            return
          }
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          save()
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="solid"
          className="px-2"
          disabled={!text.trim() || edit.isPending}
          onClick={save}
        >
          Save
        </Button>
        <Button className="px-2" onClick={onDone}>
          Cancel
        </Button>
        <AttachButton onPick={take} />
        {attaching && <span className="font-mono text-xs text-text-3">attaching…</span>}
      </div>

      <ReplaceImageDialog
        open={!!replacing}
        onKeep={() => setReplacing(null)}
        onReplace={() => {
          const image = replacing
          setReplacing(null)
          if (image) void attach(image)
        }}
      />
    </div>
  )
}

/** One image per note, so the second one asks before it displaces the first. */
function ReplaceImageDialog({
  open,
  onKeep,
  onReplace,
}: {
  open: boolean
  onKeep: () => void
  onReplace: () => void
}) {
  return (
    <Dialog open={open} onClose={onKeep} size="sm" label="Replace this note’s picture?">
      <div className="flex flex-col gap-4 p-4">
        <p className="m-0 text-base text-text">Replace this note’s picture?</p>
        <p className="m-0 text-sm text-text-3">
          A note carries one picture. Keep both by writing a second note.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onKeep}>Keep the old one</Button>
          <Button variant="danger" onClick={onReplace}>
            Replace
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Deleting a note takes its picture with it — the server's delete is the one
 * cleanup hook for the PNG — so it is the one note action that asks first
 * (decision 25e). There is no undo beyond this question.
 */
export function DeleteNoteDialog({ note, onClose }: { note: TestNote | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const remove = trpc.notes.remove.useMutation({
    onSuccess: () => {
      if (note) void utils.notes.list.invalidate({ featureId: note.featureId })
      onClose()
    },
    onError: (e) => {
      toast.push(e.message)
      onClose()
    },
  })

  return (
    <Dialog open={!!note} onClose={onClose} size="sm" label="Delete this note and its picture?">
      <div className="flex flex-col gap-4 p-4">
        <p className="m-0 text-base text-text">Delete this note and its picture?</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => note && remove.mutate({ noteId: note.id })}
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
