// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Where a drag-select capture lands (project-level-test-drive decision 1): a
 * feature drive's DrivePanel writes the feature's test note, a project drive's
 * writes a project note and attaches the PNG to it.
 *
 * Tier 2, because the save only exists after a drag. The browser's capture APIs
 * — `getDisplayMedia`, the video tap, the canvas — are the system boundary and
 * are stubbed; the crop arithmetic is `capture.test.ts`'s.
 */

const featureAdd = vi.fn(async (input: { featureId: string; text: string }) => ({
  id: 'note_1',
  ...input,
}))
const projectAdd = vi.fn(async (input: { projectId: string; text: string }) => ({
  id: 'pnote_1',
  ...input,
}))
const sendCrop = vi.fn(async (input: { featureId: string; png: string; text: string }) => ({
  path: `/data/design-crops/${input.featureId}/1.png`,
}))
const invalidateNotes = vi.fn()
const invalidateProjectNotes = vi.fn()
const uploadScreenshot = vi.fn(async () => {})
const uploadProjectNoteScreenshot = vi.fn(async () => {})

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      notes: { list: { invalidate: invalidateNotes } },
      projectNotes: { invalidate: invalidateProjectNotes },
      client: { projectNotes: { add: { mutate: projectAdd } }, design: { sendCrop: { mutate: sendCrop } } },
    }),
    notes: { add: { useMutation: () => ({ mutateAsync: featureAdd }) } },
  },
}))
const push = vi.fn()
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push }) }))
vi.mock('../src/lib/reviews', () => ({ uploadScreenshot }))
vi.mock('../src/lib/project-notes', () => ({ uploadProjectNoteScreenshot }))

const { DrivePanel } = await import('../src/components/review/DrivePanel')

const stream = { getVideoTracks: () => [], getTracks: () => [] }

beforeEach(() => {
  // A Chromium that can capture its own tab.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn(async () => stream) },
  })
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: {} })
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get: () => null,
    set: () => {},
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done(new Blob(['png'], { type: 'image/png' })),
  )
  URL.createObjectURL = vi.fn(() => 'blob:shot')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Select area, drag a region, then save the note with the given words. */
async function captureAndSave(
  text = '',
  { ask = 'what’s wrong here?', send = 'Save note' }: { ask?: string; send?: string } = {},
): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Select area' }))
  })
  const shade = await screen.findByLabelText('drag over the part of the app that needs fixing')
  fireEvent.pointerDown(shade, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(shade, { clientX: 200, clientY: 150, pointerId: 1 })
  fireEvent.pointerUp(shade, { clientX: 200, clientY: 150, pointerId: 1 })
  const box = await screen.findByLabelText(ask, {}, { timeout: 2000 })
  if (text) fireEvent.change(box, { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: send }))
  })
}

/** Whether `el` sits in an absolutely placed layer — floating over the frame — below `root`. */
function floats(el: Element, root: Element): boolean {
  for (let at = el.parentElement; at && at !== root; at = at.parentElement) {
    if (at.classList.contains('absolute')) return true
  }
  return false
}

describe('DrivePanel toolbar placement', () => {
  it('floats the toolbar over the app on a drive', () => {
    const { container } = render(<DrivePanel featureId="feat_1" url="about:blank" />)
    expect(floats(screen.getByRole('button', { name: 'Reload' }), container)).toBe(true)
  })

  it('puts the toolbar in a bar above the frame, over none of it, and selects over the frame alone', async () => {
    const { container } = render(<DrivePanel featureId="feat_1" sendTo="chat" toolbarPlacement="bar" url="about:blank" />)
    const frame = container.querySelector('iframe')!
    for (const name of ['Select area', 'Reload']) {
      const button = screen.getByRole('button', { name })
      expect(floats(button, container), name).toBe(false)
      expect(frame.parentElement!.contains(button), name).toBe(false)
      // The bar comes first in the document: above the frame, not after it.
      expect(button.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(floats(screen.getByRole('link', { name: 'Open in a new tab' }), container)).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select area' }))
    })
    const shade = await screen.findByLabelText('drag over the part of the app that needs fixing')
    expect(shade.parentElement).toBe(frame.parentElement)
  })
})

describe('DrivePanel screen width', () => {
  beforeEach(() => localStorage.clear())

  const frameWidth = (container: HTMLElement): string => container.querySelector('iframe')!.style.width

  it('lays the page out at Desktop 1440 by default, on a drive and in the design view alike', () => {
    const drive = render(<DrivePanel featureId="feat_1" url="about:blank" />)
    expect(frameWidth(drive.container)).toBe('1440px')
    expect(screen.getByRole('combobox', { name: 'Screen width' }).textContent).toMatch(/^1440 · \d+%$/)
    drive.unmount()
    const design = render(<DrivePanel featureId="feat_1" sendTo="chat" toolbarPlacement="bar" url="about:blank" />)
    expect(frameWidth(design.container)).toBe('1440px')
  })

  it('takes the width the agent asked for over the remembered one, without remembering it', () => {
    localStorage.setItem('runcastle.preview.width', '768')
    const { container } = render(<DrivePanel featureId="feat_1" sendTo="chat" toolbarPlacement="bar" url="about:blank" width={390} />)
    expect(frameWidth(container)).toBe('390px')
    expect(localStorage.getItem('runcastle.preview.width')).toBe('768')
  })

  it('fills the pane at the remembered Fit', () => {
    localStorage.setItem('runcastle.preview.width', 'fit')
    const { container } = render(<DrivePanel featureId="feat_1" url="about:blank" />)
    expect(frameWidth(container)).toBe('')
    expect(screen.getByRole('combobox', { name: 'Screen width' }).textContent).toBe('Fit')
  })
})

describe('DrivePanel capture target', () => {
  it('writes a project note and attaches the screenshot on a project drive', async () => {
    render(<DrivePanel projectId="proj_1" url="about:blank" />)
    await captureAndSave('the header overlaps')

    await waitFor(() =>
      expect(projectAdd).toHaveBeenCalledWith({ projectId: 'proj_1', text: 'the header overlaps' }),
    )
    expect(uploadProjectNoteScreenshot).toHaveBeenCalledWith('pnote_1', expect.any(Blob))
    expect(invalidateProjectNotes).toHaveBeenCalled()
    expect(featureAdd).not.toHaveBeenCalled()
    expect(uploadScreenshot).not.toHaveBeenCalled()
  })

  it('still writes the feature test note on a feature drive', async () => {
    render(<DrivePanel featureId="feat_1" url="about:blank" />)
    await captureAndSave()

    await waitFor(() =>
      expect(featureAdd).toHaveBeenCalledWith({
        featureId: 'feat_1',
        text: 'Screenshot from the test drive',
      }),
    )
    expect(uploadScreenshot).toHaveBeenCalledWith('note_1', expect.any(Blob))
    expect(invalidateNotes).toHaveBeenCalledWith({ featureId: 'feat_1' })
    expect(projectAdd).not.toHaveBeenCalled()
    expect(sendCrop).not.toHaveBeenCalled()
  })

  it('sends the crop and the words into the live chat from the design view, writing no note', async () => {
    render(<DrivePanel featureId="feat_1" sendTo="chat" url="about:blank" />)
    await captureAndSave('make this quieter', { ask: 'what should change?', send: 'Send to chat' })

    // The stubbed canvas hands back the bytes "png".
    await waitFor(() =>
      expect(sendCrop).toHaveBeenCalledWith({ featureId: 'feat_1', png: btoa('png'), text: 'make this quieter' }),
    )
    expect(featureAdd).not.toHaveBeenCalled()
    expect(uploadScreenshot).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send to chat' })).toBeNull())
  })

  it('toasts the server’s reason and keeps the crop when the chat is not running', async () => {
    sendCrop.mockRejectedValueOnce(new Error('the chat is not running — open it, then select again'))
    render(<DrivePanel featureId="feat_1" sendTo="chat" url="about:blank" />)
    await captureAndSave('', { ask: 'what should change?', send: 'Send to chat' })

    await waitFor(() => expect(push).toHaveBeenCalledWith('the chat is not running — open it, then select again'))
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
  })
})
