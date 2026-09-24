import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react'
import { trpc } from '../trpc'
import { imageOnClipboard, toPngBlob } from '../lib/reviews'
import { uploadProjectNoteScreenshot } from '../lib/project-notes'
import { useToast } from '../lib/toast'
import { Dialog, Kbd } from '../ui'
import { IconCheck, IconPencil, IconX } from '../icons'

/**
 * Jot a project note, from wherever you were standing (project-notes,
 * decisions #3, #16 and #18).
 *
 * One focused line and an optional pasted screenshot, and nothing else: the
 * whole contract is that an observation gets out of the human's head in under
 * ten seconds. All the thinking happens later, in the project chat — so there
 * is no destination picker, no severity, and no project picker either (the note
 * belongs to the project this shell is showing).
 *
 * It is shaped like the ⌘K palette — top-centre, the palette's width, one large
 * borderless line — because that is the capture gesture the app already
 * teaches, over a light scrim so the page being noted stays readable. There is
 * no Save button: Enter saves. It runs its mechanics through `Dialog` like every
 * other overlay (apps/web/STYLE.md), which is what gives it Escape-discards,
 * focus on open and focus back to whatever you were doing on close.
 *
 * Saving confirms in place: the bar becomes "Noted in <project> · N open · View",
 * the scrim lifts at once so nothing feels stuck behind a modal, and the bar
 * closes itself a moment later.
 */

/** How long the confirmation stays up before the bar closes itself. */
const CONFIRM_MS = 1500

/** The one picture a note may carry, staged before the note exists. */
interface StagedImage {
  png: Blob
  /** An object URL for the thumbnail, revoked when the staging is replaced. */
  preview: string
}

export interface NoteCaptureProps {
  projectId: string
  /** Where the note goes — shown, never picked. */
  projectName: string
  open: boolean
  /** Bumped by every press of a door onto capture, so one pressed while the bar
   *  is already up still reaches it (`open` does not change then). */
  openRequest?: number
  onClose: () => void
  /** Open the project workspace, where the pile is read and triaged. */
  onOpenInbox: () => void
}

/** A text-coloured link inside a `<button>`: the unlayered `button { color:
 *  inherit }` beats a colour written on the button, so it goes on a span. */
const LINK_BUTTON = 'cursor-pointer rounded-sm border-0 bg-transparent p-0'

export function NoteCapture({
  projectId,
  projectName,
  open,
  openRequest = 0,
  onClose,
  onOpenInbox,
}: NoteCaptureProps) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<StagedImage | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Every open is a fresh note, and the reset happens DURING the render that
  // opens it (decision #18). The component stays mounted while closed, so the
  // last save's confirmation survives until then; resetting in an effect let the
  // first open render show that confirmation with no input in it, and `Dialog`'s
  // focus effect — which runs before ours — fell back to focusing the panel.
  // Each open or close starts a new session, and a save only confirms in the
  // session it began in: a request that lands after the bar was closed (and
  // perhaps reopened on a fresh line) must not take that line over.
  const session = useRef(0)
  const fresh = (): void => {
    setText('')
    setStaged(null)
    setSaving(false)
    setSaved(false)
  }
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    session.current += 1
    if (open) fresh()
  }
  // A door pressed while the bar is already up is not an open edge, so it is
  // read off `openRequest` instead. Over the confirmation it starts the next
  // note — jotting two things in a row is the natural burst — and unmounting the
  // confirmation cancels its close timer. Over a line being typed it only puts
  // the cursor back; the half-written note is kept.
  const [seenRequest, setSeenRequest] = useState(openRequest)
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest)
    if (open && saved) fresh()
  }
  useEffect(() => {
    if (open) inputRef.current?.focus()
    // Keyed on the request alone: the open edge's focus is `Dialog`'s job.
  }, [openRequest])

  const add = trpc.projectNotes.add.useMutation()
  // Only while the box is up: the rail's badge is the count's standing reader,
  // and this one exists for the confirmation line.
  const openCount = trpc.projectNotes.openCount.useQuery({ projectId }, { enabled: open })

  // The live object URL is mirrored into a ref so closing mid-capture revokes
  // the one the thumbnail was reading — keying the cleanup on `staged` would
  // instead revoke the URL the render just used.
  const preview = useRef<string | null>(null)
  useEffect(() => {
    preview.current = staged?.preview ?? null
  }, [staged])
  useEffect(() => {
    if (!open) return
    return () => {
      if (preview.current) URL.revokeObjectURL(preview.current)
    }
  }, [open])

  // The confirmation closes the box for you. `onClose` is read through a ref so
  // a caller passing an inline closure does not restart the timer every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => closeRef.current(), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [saved])

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

  const drop = (): void => {
    setStaged((current) => {
      if (current) URL.revokeObjectURL(current.preview)
      return null
    })
    inputRef.current?.focus()
  }

  const onPaste = (e: ReactClipboardEvent<HTMLElement>): void => {
    const image = imageOnClipboard(e.clipboardData)
    if (!image) return
    e.preventDefault()
    void stage(image)
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() || saving) return
    const started = session.current
    const current = (): boolean => session.current === started
    setSaving(true)
    try {
      // Note first, PNG second — the upload is keyed by the id the server just
      // minted, the same order a test note's screenshot travels in.
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
      // The count was read when the bar opened, before this note existed: bump
      // the cached one so the confirmation's first frame already includes it,
      // and let the refetch the invalidate starts settle the true number.
      utils.projectNotes.openCount.setData({ projectId }, (n) => (n === undefined ? n : n + 1))
      void utils.projectNotes.invalidate()
      if (current()) setSaved(true)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the note could not be saved')
    } finally {
      if (current()) setSaving(false)
    }
  }

  const readInbox = (): void => {
    onOpenInbox()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="palette"
      scrim={saved ? 'none' : 'light'}
      className="overflow-hidden"
      label="Jot a note"
      initialFocusRef={inputRef}
    >
      {saved ? (
        <div className="flex h-13 items-center gap-2.5 px-3.5 text-base" role="status">
          <span className="flex shrink-0 items-center text-ok">
            <IconCheck size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-text-2">
            Noted in <span className="font-medium text-text">{projectName}</span>
            {openCount.data !== undefined && <> · {openCount.data} open</>}
          </span>
          <button
            className={LINK_BUTTON}
            onClick={readInbox}
            title="Read the pile on the project workspace"
          >
            <span className="text-sm text-accent-hi hover:underline">View</span>
          </button>
        </div>
      ) : (
        <div onPaste={onPaste}>
          <div className="flex h-13 items-center gap-2.5 px-3.5">
            <span className="flex shrink-0 items-center text-accent-hi">
              <IconPencil size={16} />
            </span>
            <input
              ref={inputRef}
              // `font-sans` because there is no preflight: an `<input>` keeps the
              // UA's own face and size unless it is told otherwise.
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-lg text-text outline-none placeholder:text-text-4"
              autoComplete="off"
              aria-label="what did you just notice?"
              placeholder="What did you just notice?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void submit()
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-hairline-soft bg-panel-2 px-3.5 py-2 text-sm text-text-3">
            {staged ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-hairline-strong bg-panel-3 pr-1 pl-0.5 text-text-2">
                <img
                  src={staged.preview}
                  alt="the picture this note will carry"
                  className="h-4.5 w-7 rounded-[3px] bg-black object-cover"
                />
                Screenshot
                <button
                  className="flex size-4.5 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 hover:bg-hairline"
                  aria-label="remove the picture"
                  title="Remove the picture"
                  onClick={drop}
                >
                  <span className="flex items-center text-text-3">
                    <IconX size={10} />
                  </span>
                </button>
              </span>
            ) : (
              <span>Paste a screenshot</span>
            )}
            <span className="flex-1" />
            <span>
              to <span className="font-medium text-text-2">{projectName}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> save
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd> close
            </span>
          </div>
        </div>
      )}
    </Dialog>
  )
}
