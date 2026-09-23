import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react'
import { trpc } from '../trpc'
import { imageOnClipboard, toPngBlob } from '../lib/reviews'
import { uploadProjectNoteScreenshot } from '../lib/project-notes'
import { useToast } from '../lib/toast'
import { Button, Dialog, Kbd } from '../ui'
import { IconX } from '../icons'

/**
 * Jot a project note, from wherever you were standing (project-notes,
 * decisions #3 and #10).
 *
 * One focused line and an optional pasted screenshot, and nothing else: the
 * whole contract is that an observation gets out of the human's head in under
 * ten seconds. All the thinking happens later, in the project chat — so there
 * is no destination picker, no severity, and no project picker either (the note
 * belongs to the project this shell is showing).
 *
 * It runs its mechanics through `Dialog` like every other overlay in the app
 * (apps/web/STYLE.md), which is what gives it Escape-discards, focus on open and
 * focus back to whatever you were doing on close.
 *
 * Saving does not close the box immediately: it swaps to "Saved · N open" for a
 * moment so the pile is visible growing, and the count is the door to the inbox
 * — then it closes itself.
 */

/** How long the confirmation stays up before the popover closes itself. */
const CONFIRM_MS = 2500

/** The one picture a note may carry, staged before the note exists. */
interface StagedImage {
  png: Blob
  /** An object URL for the thumbnail, revoked when the staging is replaced. */
  preview: string
}

export interface NoteCaptureProps {
  projectId: string
  open: boolean
  onClose: () => void
  /** Open the project chat door, where the pile is read and triaged. */
  onOpenInbox: () => void
}

const NOTE_INPUT =
  'w-full rounded-md border border-hairline bg-panel-inset px-3 py-2 font-sans text-base ' +
  'text-text placeholder:text-text-4 focus:border-accent-line focus:outline-none'

export function NoteCapture({ projectId, open, onClose, onOpenInbox }: NoteCaptureProps) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<StagedImage | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const add = trpc.projectNotes.add.useMutation()
  // Only while the box is up: the rail's badge is the count's standing reader,
  // and this one exists for the confirmation line.
  const openCount = trpc.projectNotes.openCount.useQuery({ projectId }, { enabled: open })

  // Every open is a fresh note. The live object URL is mirrored into a ref so
  // closing mid-capture revokes the one the thumbnail was reading — keying the
  // cleanup on `staged` would instead revoke the URL the render just used.
  const preview = useRef<string | null>(null)
  useEffect(() => {
    preview.current = staged?.preview ?? null
  }, [staged])
  useEffect(() => {
    if (!open) return
    setText('')
    setStaged(null)
    setSaving(false)
    setSaved(false)
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
  }

  const onPaste = (e: ReactClipboardEvent<HTMLElement>): void => {
    const image = imageOnClipboard(e.clipboardData)
    if (!image) return
    e.preventDefault()
    void stage(image)
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() || saving) return
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
      void utils.projectNotes.invalidate()
      setSaved(true)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the note could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const readInbox = (): void => {
    onOpenInbox()
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" label="Jot a note" initialFocusRef={inputRef}>
      <div className="flex flex-col gap-3 p-4" onPaste={onPaste}>
        {saved ? (
          <div className="flex items-center gap-2 text-base text-text-2">
            <span className="text-ok">Saved</span>
            {openCount.data !== undefined && (
              <>
                <span className="text-text-4" aria-hidden="true">
                  ·
                </span>
                <button
                  className="cursor-pointer rounded-sm border-0 bg-transparent p-0 underline underline-offset-2"
                  onClick={readInbox}
                  title="Read the pile on the project chat door"
                >
                  <span className="text-accent-hi">{openCount.data} open</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className={NOTE_INPUT}
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

            {staged && (
              <div className="flex items-center gap-2">
                <img
                  src={staged.preview}
                  alt="the picture this note will carry"
                  className="h-[54px] w-24 rounded-sm border border-hairline bg-black object-cover"
                />
                <button
                  className="flex cursor-pointer items-center rounded-sm border-0 bg-transparent p-1 hover:bg-panel-3"
                  aria-label="remove the picture"
                  title="Remove the picture"
                  onClick={drop}
                >
                  <span className="flex items-center text-text-3">
                    <IconX size={13} />
                  </span>
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="solid"
                disabled={!text.trim() || saving}
                onClick={() => void submit()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <span className="flex items-center gap-1.5 text-sm text-text-3">
                <Kbd>↵</Kbd> saves · <Kbd>esc</Kbd> discards · paste a screenshot
              </span>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
