// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestNote } from '@runcastle/core'

/**
 * Capturing a note with a picture, changing one, deleting one, and looking at
 * the picture (decisions 7a, 25d–g, 26).
 *
 * Tier 2 because none of it is a string: paste is a clipboard event, the
 * one-image-per-note question and the delete confirm are portalled dialogs, and
 * the whole point of the upload is WHAT it is handed. The upload route and the
 * image decoder are the true system boundaries and are the only things stubbed —
 * the assertion is always the note id and the bytes `uploadScreenshot` receives,
 * never rasterised pixels (decision 36).
 */

const uploadScreenshot = vi.fn(async () => undefined)
const toPngBlob = vi.fn(async (image: Blob) =>
  image.type === 'image/png' ? image : new Blob(['converted'], { type: 'image/png' }),
)

vi.mock('../src/lib/reviews', () => ({
  uploadScreenshot: (...args: unknown[]) => uploadScreenshot(...(args as [])),
  toPngBlob: (image: Blob) => toPngBlob(image),
}))

const addNote = vi.fn(async () => NOTE)
const editNote = vi.fn()
const removeNote = vi.fn()
const invalidate = vi.fn()
const pushToast = vi.fn()

vi.mock('../src/trpc', () => {
  const stub = (impl: { mutate?: unknown; mutateAsync?: unknown }) => () => ({
    mutate: impl.mutate ?? vi.fn(),
    mutateAsync: impl.mutateAsync ?? vi.fn(),
    isPending: false,
  })
  return {
    trpc: {
      useUtils: () => ({ notes: { list: { invalidate: (...a: unknown[]) => invalidate(...a) } } }),
      notes: {
        add: { useMutation: stub({ mutateAsync: (...a: unknown[]) => addNote(...(a as [])) }) },
        edit: { useMutation: stub({ mutate: (...a: unknown[]) => editNote(...a) }) },
        remove: { useMutation: stub({ mutate: (...a: unknown[]) => removeNote(...a) }) },
      },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: pushToast }) }))

const { DeleteNoteDialog, NoteComposer, NoteEditor } = await import(
  '../src/components/review/NoteComposer'
)
const { Lightbox } = await import('../src/components/review/Lightbox')
const { NoteRow } = await import('../src/components/review/NoteRow')

const NOTE: TestNote = {
  id: 'note_1',
  featureId: 'ftr_1',
  lap: 2,
  text: 'the run chip goes grey while burning',
  status: 'open',
  author: 'human',
  videoTimestamp: 42,
  reviewTicketId: 'tkt_review_2',
  createdAt: 1,
  updatedAt: 1,
}

const PNG = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
const JPEG = new File([new Uint8Array([2])], 'shot.jpg', { type: 'image/jpeg' })

/** Paste an image onto whatever is under the caret. */
function pasteImage(target: Element, file: File): void {
  fireEvent.paste(target, { clipboardData: { files: [file], items: [] } })
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:preview',
    revokeObjectURL: () => undefined,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const field = (name: RegExp | string) => screen.getByLabelText(name)
const button = (name: RegExp | string) => screen.getByRole('button', { name })

describe('NoteComposer', () => {
  it('takes a pasted screenshot and uploads it to the note it just created', async () => {
    render(<NoteComposer featureId="ftr_1" />)
    const text = field(/what did you just see/i)

    fireEvent.change(text, { target: { value: 'the header overlaps the frame' } })
    pasteImage(text, PNG)

    // The picture is staged and visible before the note exists — the human sees
    // what they are about to attach.
    await screen.findByAltText('the picture this note will carry')

    fireEvent.click(button(/^Add$/))

    await waitFor(() => expect(uploadScreenshot).toHaveBeenCalled())
    // Note first, PNG second, keyed by the note the server just minted.
    expect(addNote).toHaveBeenCalledWith({
      featureId: 'ftr_1',
      text: 'the header overlaps the frame',
    })
    expect(uploadScreenshot.mock.calls[0]).toEqual(['note_1', PNG])
  })

  it('converts a pasted image that is not a PNG before it is uploaded', async () => {
    render(<NoteComposer featureId="ftr_1" />)
    const text = field(/what did you just see/i)

    fireEvent.change(text, { target: { value: 'the chip is the wrong colour' } })
    pasteImage(text, JPEG)
    await screen.findByAltText('the picture this note will carry')
    fireEvent.click(button(/^Add$/))

    await waitFor(() => expect(uploadScreenshot).toHaveBeenCalled())
    expect(toPngBlob).toHaveBeenCalledWith(JPEG)
    const [, uploaded] = uploadScreenshot.mock.calls[0] as unknown as [string, Blob]
    expect(uploaded.type).toBe('image/png')
    expect(uploaded).not.toBe(JPEG)
  })

  it('asks before a second picture displaces the first — one image per note', async () => {
    render(<NoteComposer featureId="ftr_1" />)
    const text = field(/what did you just see/i)
    fireEvent.change(text, { target: { value: 'two pictures' } })

    pasteImage(text, PNG)
    await screen.findByAltText('the picture this note will carry')
    pasteImage(text, JPEG)

    await screen.findByText('Replace this note’s picture?')
    // Nothing has moved until the question is answered.
    expect(toPngBlob).toHaveBeenCalledTimes(1)

    fireEvent.click(button(/^Replace$/))
    await waitFor(() => expect(toPngBlob).toHaveBeenCalledWith(JPEG))
  })

  it('does not save an empty note, and does not upload without a note', () => {
    render(<NoteComposer featureId="ftr_1" />)
    expect((button(/^Add$/) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(field(/what did you just see/i), { key: 'Enter' })
    expect(addNote).not.toHaveBeenCalled()
  })

  it('breaks the line on Shift+Enter rather than saving', () => {
    render(<NoteComposer featureId="ftr_1" />)
    const text = field(/what did you just see/i)
    fireEvent.change(text, { target: { value: 'first line' } })
    fireEvent.keyDown(text, { key: 'Enter', shiftKey: true })
    expect(addNote).not.toHaveBeenCalled()
  })
})

describe('NoteEditor', () => {
  /** The editor as the list mounts it: inside the row it is editing. */
  function mountInRow(note: TestNote = NOTE) {
    return render(
      <NoteRow
        item={{ kind: 'note', note }}
        onStage={{ ticketId: 'tkt_review_2' }}
        readonly={false}
        editor={<NoteEditor note={note} onDone={() => undefined} />}
        onOpenImage={() => undefined}
      />,
    )
  }

  it('keeps the picture and the moment on screen while the words are changed', () => {
    mountInRow({ ...NOTE, screenshotUrl: '/api/reviews/note/note_1/screenshot.png' })

    expect((field(/edit this note/i) as HTMLTextAreaElement).value).toBe(NOTE.text)
    expect(screen.getByAltText('the picture attached to this note')).toBeTruthy()
    expect(screen.getByRole('button', { name: '0:42' })).toBeTruthy()
  })

  it('saves on Enter and leaves a new line to Shift+Enter', () => {
    mountInRow()
    const text = field(/edit this note/i)

    fireEvent.change(text, { target: { value: 'the chip stays grey after it lands' } })
    fireEvent.keyDown(text, { key: 'Enter', shiftKey: true })
    expect(editNote).not.toHaveBeenCalled()

    fireEvent.keyDown(text, { key: 'Enter' })
    expect(editNote).toHaveBeenCalledWith({
      noteId: 'note_1',
      text: 'the chip stays grey after it lands',
    })
  })

  it('uploads a pasted picture straight onto a note that has none', async () => {
    mountInRow()
    pasteImage(field(/edit this note/i), PNG)
    await waitFor(() => expect(uploadScreenshot).toHaveBeenCalledWith('note_1', PNG))
  })

  it('asks before replacing a picture the note already carries', async () => {
    mountInRow({ ...NOTE, screenshotUrl: '/api/reviews/note/note_1/screenshot.png' })
    pasteImage(field(/edit this note/i), JPEG)

    await screen.findByText('Replace this note’s picture?')
    expect(uploadScreenshot).not.toHaveBeenCalled()

    fireEvent.click(button(/^Replace$/))
    await waitFor(() => expect(uploadScreenshot).toHaveBeenCalledTimes(1))
    expect((uploadScreenshot.mock.calls[0] as unknown as [string, Blob])[0]).toBe('note_1')
  })
})

describe('DeleteNoteDialog', () => {
  it('asks about the picture as well as the note, and only then deletes', () => {
    render(<DeleteNoteDialog note={NOTE} onClose={() => undefined} />)

    expect(screen.getByText('Delete this note and its picture?')).toBeTruthy()
    expect(removeNote).not.toHaveBeenCalled()

    fireEvent.click(button(/^Delete$/))
    expect(removeNote).toHaveBeenCalledWith({ noteId: 'note_1' })
  })

  it('is not mounted at all until a row asks for it', () => {
    render(<DeleteNoteDialog note={null} onClose={() => undefined} />)
    expect(screen.queryByText('Delete this note and its picture?')).toBeNull()
  })
})

describe('Lightbox', () => {
  it('opens the whole picture in the app and closes on Escape', () => {
    const onClose = vi.fn()
    render(<Lightbox url="/api/reviews/note/note_1/screenshot.png" onClose={onClose} />)

    const picture = screen.getByAltText('the picture attached to this note')
    expect(picture.getAttribute('src')).toBe('/api/reviews/note/note_1/screenshot.png')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside the picture', () => {
    const onClose = vi.fn()
    render(<Lightbox url="/api/reviews/note/note_1/screenshot.png" onClose={onClose} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog.parentElement!)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows nothing when no thumbnail has been clicked', () => {
    render(<Lightbox url={null} onClose={() => undefined} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the thumbnail', () => {
  it('opens the lightbox rather than a browser tab', () => {
    const onOpenImage = vi.fn()
    render(
      <NoteRow
        item={{ kind: 'note', note: { ...NOTE, screenshotUrl: '/shot.png' } }}
        onStage={null}
        readonly={false}
        onOpenImage={onOpenImage}
      />,
    )

    fireEvent.click(screen.getByTitle('see the whole picture'))
    expect(onOpenImage).toHaveBeenCalledWith('/shot.png')
  })
})
