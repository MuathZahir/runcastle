// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'

/**
 * Capturing a project note from wherever you were standing (project-notes
 * decisions #3, #10).
 *
 * Tier 2 (apps/web/STYLE.md): the popover is a portalled dialog, paste is a
 * clipboard event, Escape is a window listener, and the confirmation is a timer
 * — none of that is a string. The screenshot upload and the image decoder are
 * the true system boundaries and are the only things stubbed; the assertion is
 * always the note id and the bytes the upload was handed.
 */

const uploadProjectNoteScreenshot = vi.fn(async (_noteId: string, _png: Blob) => undefined)
const toPngBlob = vi.fn(async (image: Blob) =>
  image.type === 'image/png' ? image : new Blob(['converted'], { type: 'image/png' }),
)

vi.mock('../src/lib/project-notes', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadProjectNoteScreenshot: (...args: unknown[]) =>
    uploadProjectNoteScreenshot(...(args as [string, Blob])),
}))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toPngBlob: (image: Blob) => toPngBlob(image),
}))

const addNote = vi.fn(async () => NOTE)
const invalidate = vi.fn()
const pushToast = vi.fn()
const openCount = { data: 3 as number | undefined }

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ projectNotes: { invalidate: (...a: unknown[]) => invalidate(...a) } }),
    projectNotes: {
      add: {
        useMutation: () => ({ mutateAsync: (...a: unknown[]) => addNote(...(a as [])) }),
      },
      openCount: { useQuery: () => openCount },
    },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: pushToast }) }))

const { NoteCapture } = await import('../src/components/NoteCapture')

const NOTE: ProjectNote = {
  id: 'pnote_1',
  projectId: 'proj_1',
  text: 'the crumbs overflow at 900px',
  status: 'open',
  createdAt: 1,
  updatedAt: 1,
}

const PNG = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
const JPEG = new File([new Uint8Array([2])], 'shot.jpg', { type: 'image/jpeg' })

const onClose = vi.fn()
const onOpenInbox = vi.fn()

function popover(open = true) {
  return render(
    <NoteCapture projectId="proj_1" open={open} onClose={onClose} onOpenInbox={onOpenInbox} />,
  )
}

const line = () => screen.getByLabelText(/what did you just notice/i)

/** Paste an image onto whatever is under the caret. */
function pasteImage(target: Element, file: File): void {
  fireEvent.paste(target, { clipboardData: { files: [file], items: [] } })
}

beforeEach(() => {
  openCount.data = 3
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
  vi.useRealTimers()
})

describe('NoteCapture', () => {
  it('renders nothing until it is opened', () => {
    popover(false)

    expect(screen.queryByLabelText(/what did you just notice/i)).toBeNull()
  })

  it('saves the typed line to the current project on Enter', async () => {
    popover()

    fireEvent.change(line(), { target: { value: 'the crumbs overflow at 900px' } })
    fireEvent.keyDown(line(), { key: 'Enter' })

    await waitFor(() => expect(addNote).toHaveBeenCalled())
    expect(addNote).toHaveBeenCalledWith({
      projectId: 'proj_1',
      text: 'the crumbs overflow at 900px',
    })
    // No picture was pasted, so nothing is uploaded.
    expect(uploadProjectNoteScreenshot).not.toHaveBeenCalled()
  })

  it('does not save an empty line', () => {
    popover()

    fireEvent.keyDown(line(), { key: 'Enter' })
    fireEvent.keyDown(line(), { key: 'Enter' })

    expect(addNote).not.toHaveBeenCalled()
  })

  it('discards on Escape without saving', () => {
    popover()

    fireEvent.change(line(), { target: { value: 'half a thought' } })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(addNote).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('stages a pasted screenshot as a removable thumbnail and uploads it to the new note', async () => {
    popover()

    fireEvent.change(line(), { target: { value: 'the crumbs overflow at 900px' } })
    pasteImage(line(), PNG)
    await screen.findByAltText('the picture this note will carry')

    fireEvent.keyDown(line(), { key: 'Enter' })

    await waitFor(() => expect(uploadProjectNoteScreenshot).toHaveBeenCalled())
    // Note first, PNG second, keyed by the id the server just minted.
    expect(uploadProjectNoteScreenshot.mock.calls[0]).toEqual(['pnote_1', PNG])
  })

  it('converts a pasted image that is not a PNG before uploading it', async () => {
    popover()

    fireEvent.change(line(), { target: { value: 'the chip is the wrong colour' } })
    pasteImage(line(), JPEG)
    await screen.findByAltText('the picture this note will carry')
    fireEvent.keyDown(line(), { key: 'Enter' })

    await waitFor(() => expect(uploadProjectNoteScreenshot).toHaveBeenCalled())
    expect(toPngBlob).toHaveBeenCalledWith(JPEG)
    expect(uploadProjectNoteScreenshot.mock.calls[0]?.[1]).not.toBe(JPEG)
  })

  it('removes a staged picture so the note saves without one', async () => {
    popover()

    fireEvent.change(line(), { target: { value: 'never mind the picture' } })
    pasteImage(line(), PNG)
    await screen.findByAltText('the picture this note will carry')

    fireEvent.click(screen.getByRole('button', { name: /remove the picture/i }))
    await waitFor(() =>
      expect(screen.queryByAltText('the picture this note will carry')).toBeNull(),
    )

    fireEvent.keyDown(line(), { key: 'Enter' })
    await waitFor(() => expect(addNote).toHaveBeenCalled())
    expect(uploadProjectNoteScreenshot).not.toHaveBeenCalled()
  })

  it('confirms with the open count, which opens the inbox', async () => {
    popover()

    fireEvent.change(line(), { target: { value: 'the crumbs overflow at 900px' } })
    fireEvent.keyDown(line(), { key: 'Enter' })

    const count = await screen.findByRole('button', { name: /3 open/ })
    await screen.findByText('Saved')
    // The pile is what the count refreshes — the badge and the inbox read it.
    expect(invalidate).toHaveBeenCalled()

    fireEvent.click(count)
    expect(onOpenInbox).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes itself once the confirmation has been up a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    popover()

    fireEvent.change(line(), { target: { value: 'the crumbs overflow at 900px' } })
    fireEvent.keyDown(line(), { key: 'Enter' })
    await screen.findByText('Saved')
    expect(onClose).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    expect(onClose).toHaveBeenCalled()
  })
})
