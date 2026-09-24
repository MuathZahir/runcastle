// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'

/**
 * Capturing a project note from wherever you were standing (project-notes
 * decisions #3, #10, #16, #18).
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
/** The cached open count — the query cache is the one seam the bar writes to
 *  besides the mutation, so it is a tiny store the component re-reads. */
const openCount = {
  data: 2 as number | undefined,
  listeners: new Set<() => void>(),
  set(next: number | undefined) {
    openCount.data = next
    for (const l of openCount.listeners) l()
  },
}

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      projectNotes: {
        // Never settles here: the refetch is the slow server of the repro.
        invalidate: (...a: unknown[]) => invalidate(...a),
        openCount: {
          setData: (_input: unknown, update: (n: number | undefined) => number | undefined) =>
            openCount.set(update(openCount.data)),
        },
      },
    }),
    projectNotes: {
      add: {
        useMutation: () => ({ mutateAsync: (...a: unknown[]) => addNote(...(a as [])) }),
      },
      openCount: {
        useQuery: () => ({
          data: useSyncExternalStore(
            (l) => {
              openCount.listeners.add(l)
              return () => openCount.listeners.delete(l)
            },
            () => openCount.data,
          ),
        }),
      },
    },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: pushToast }) }))

const { NoteCapture } = await import('../src/components/NoteCapture')
const { isNoteHotkey } = await import('../src/lib/project-notes')

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

function capture(open: boolean) {
  return (
    <NoteCapture
      projectId="proj_1"
      projectName="runcastle-demo"
      open={open}
      onClose={onClose}
      onOpenInbox={onOpenInbox}
    />
  )
}

function popover(open = true) {
  return render(capture(open))
}

const line = () => screen.getByLabelText(/what did you just notice/i)
/** The backdrop `Dialog` portals — the scrim. */
const scrim = () => screen.getByRole('dialog').parentElement as HTMLElement

async function saveALine(): Promise<void> {
  fireEvent.change(line(), { target: { value: 'the crumbs overflow at 900px' } })
  fireEvent.keyDown(line(), { key: 'Enter' })
  await screen.findByText(/Noted in/)
}

/** Paste an image onto whatever is under the caret. */
function pasteImage(target: Element, file: File): void {
  fireEvent.paste(target, { clipboardData: { files: [file], items: [] } })
}

beforeEach(() => {
  openCount.data = 2
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

  // Decision #16: the palette's gesture, over a scrim that leaves the page
  // readable, with Enter as the only way to save.
  it('opens palette-shaped over a light scrim, with no Save button', () => {
    popover()

    expect(screen.getByRole('dialog').className).toContain('max-w-[560px]')
    expect(scrim().className).toContain('pt-[12vh]')
    expect(scrim().className).toContain('bg-[rgba(4,6,10,0.28)]')
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('says where the note goes and how to save or close it', async () => {
    popover()

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Paste a screenshot')
    expect(dialog.textContent).toContain('to runcastle-demo')
    expect(dialog.textContent).toMatch(/↵\s*save/)
    expect(dialog.textContent).toMatch(/esc\s*close/)

    // A pasted picture takes the hint's place as a chip.
    pasteImage(line(), PNG)
    await screen.findByAltText('the picture this note will carry')
    expect(dialog.textContent).not.toContain('Paste a screenshot')
  })

  // The count was read at open (2, before this note); the refetch never returns
  // here, so the line's very first frame must already include the new note.
  it('confirms in place with the open count, and View opens the inbox', async () => {
    popover()
    await saveALine()

    expect(screen.getByRole('status').textContent).toBe('Noted in runcastle-demo · 3 openView')
    // The pile is what the count refreshes — the badge and the inbox read it.
    expect(invalidate).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(onOpenInbox).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('lifts the scrim the moment the note is saved', async () => {
    popover()
    await saveALine()

    expect(scrim().className).toContain('bg-transparent')
    expect(scrim().className).toContain('pointer-events-none')
    expect(scrim().className).not.toContain('rgba(4,6,10,0.28)')
  })

  // Decision #18: the box stays mounted while closed, and the last save's
  // confirmation used to survive into the next open — so the first render had no
  // input for Dialog to focus, and the panel took the focus instead.
  it('lands the cursor in the input on every open, including after a save', async () => {
    const view = popover()
    expect(document.activeElement).toBe(line())

    await saveALine()
    view.rerender(capture(false))
    view.rerender(capture(true))

    expect(document.activeElement).toBe(line())
    expect(line()).toHaveProperty('value', '')
  })

  // The chord reaching the window from inside xterm is terminal-keys.test.ts's
  // job; this is the other half — that the box it opens takes the focus off
  // the terminal's textarea and puts it in the line, every time.
  it('takes the focus from a terminal when ⌘/Ctrl+J opens it, every time', async () => {
    function Shell() {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (isNoteHotkey(e)) setOpen(true)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return (
        <>
          <textarea aria-label="terminal input" />
          <NoteCapture
            projectId="proj_1"
            projectName="runcastle-demo"
            open={open}
            onClose={() => setOpen(false)}
            onOpenInbox={onOpenInbox}
          />
        </>
      )
    }
    render(<Shell />)
    const terminal = screen.getByLabelText('terminal input')

    for (let round = 0; round < 2; round++) {
      terminal.focus()
      fireEvent.keyDown(terminal, { key: 'j', ctrlKey: true })
      expect(document.activeElement).toBe(line())

      await saveALine()
      fireEvent.click(screen.getByRole('button', { name: 'View' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  // The review's repro: a second ⌘/Ctrl+J during the confirmation used to be
  // swallowed (the bar was already open, so nothing changed) and the timer then
  // closed the bar. Every door counts its presses, and the count is what lands.
  describe('pressed again while the bar is up', () => {
    function Shell() {
      const [open, setOpen] = useState(false)
      const [request, setRequest] = useState(0)
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (!isNoteHotkey(e)) return
          setOpen(true)
          setRequest((n) => n + 1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return (
        <NoteCapture
          projectId="proj_1"
          projectName="runcastle-demo"
          open={open}
          openRequest={request}
          onClose={() => setOpen(false)}
          onOpenInbox={onOpenInbox}
        />
      )
    }
    const jot = async () => {
      fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())
    }

    it('starts a fresh note over the saved line, and the bar stays up', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      render(<Shell />)
      await jot()
      await saveALine()

      await vi.advanceTimersByTimeAsync(500)
      fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true })
      await waitFor(() => expect(screen.queryByText(/Noted in/)).toBeNull())

      expect(line()).toHaveProperty('value', '')
      expect(document.activeElement).toBe(line())
      // The confirmation's close timer went with it.
      await vi.advanceTimersByTimeAsync(2000)
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(document.activeElement).toBe(line())
    })

    it('keeps a half-typed line and puts the cursor back in it', async () => {
      render(<Shell />)
      await jot()
      fireEvent.change(line(), { target: { value: 'half a thought' } })
      screen.getByRole('dialog').focus()

      fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true })

      await waitFor(() => expect(document.activeElement).toBe(line()))
      expect(line()).toHaveProperty('value', 'half a thought')
    })
  })

  it('closes itself about a second and a half after saving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    popover()
    await saveALine()
    expect(onClose).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1200)
    expect(onClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(onClose).toHaveBeenCalled()
  })

  // The lifted scrim lets a click land on the page; the auto-close must not
  // then drag the caret back to the pencil mid-word.
  it('leaves the focus where the human put it when the saved line closes itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    function Shell() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Jot a note</button>
          <input aria-label="chat composer" />
          <NoteCapture
            projectId="proj_1"
            projectName="runcastle-demo"
            open={open}
            onClose={() => setOpen(false)}
            onOpenInbox={onOpenInbox}
          />
        </>
      )
    }
    render(<Shell />)
    const pencil = screen.getByRole('button', { name: 'Jot a note' })
    pencil.focus()
    fireEvent.click(pencil)
    await saveALine()

    const composer = screen.getByLabelText('chat composer')
    composer.focus()
    await vi.advanceTimersByTimeAsync(1600)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(document.activeElement).toBe(composer)
  })
})
