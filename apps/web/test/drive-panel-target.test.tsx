// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The drive frame: one head above the page, and where a drag-select capture
 * goes, which is the caller's (test-drive-looks-the-part decision 15).
 *
 * Tier 2, because the capture only exists after a drag. The browser's capture
 * APIs — `getDisplayMedia`, the video tap, the canvas — are the system boundary
 * and are stubbed; the crop arithmetic is `capture.test.ts`'s.
 */

const push = vi.fn()
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push }) }))

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

/** Select area and drag a region. */
async function selectArea(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Select area' }))
  })
  const shade = await screen.findByLabelText('drag over the part of the app that needs fixing')
  fireEvent.pointerDown(shade, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(shade, { clientX: 200, clientY: 150, pointerId: 1 })
  fireEvent.pointerUp(shade, { clientX: 200, clientY: 150, pointerId: 1 })
}

/** Whether `el` sits in an absolutely placed layer — floating over the frame — below `root`. */
function floats(el: Element, root: Element): boolean {
  for (let at = el.parentElement; at && at !== root; at = at.parentElement) {
    if (at.classList.contains('absolute')) return true
  }
  return false
}

describe('DrivePanel toolbar placement', () => {
  // A drive and the design view alike: one row above the frame, over none of it.
  it.each([
    ['a drive', {}],
    ['the design view', { copy: 'chat' as const }],
  ])('puts every control of %s in one bar above the frame, and selects over the frame alone', async (_, props) => {
    const { container } = render(
      <DrivePanel
        url="about:blank"
        leading={<button type="button">Back</button>}
        toolbar={<button type="button">Scenario</button>}
        trailing={<button type="button">Stop</button>}
        onCapture={vi.fn()}
        {...props}
      />,
    )
    const frame = container.querySelector('iframe')!
    const [bar, ...more] = screen.getAllByRole('toolbar')
    expect(more).toHaveLength(0)
    const controls = [
      ...['Back', 'Select area', 'Reload', 'Scenario', 'Stop'].map((name) => screen.getByRole('button', { name })),
      screen.getByRole('link', { name: /Open/ }),
      screen.getByRole('combobox', { name: 'Screen width' }),
    ]
    for (const control of controls) {
      expect(bar!.contains(control), control.textContent ?? '').toBe(true)
      expect(floats(control, container)).toBe(false)
      expect(frame.parentElement!.contains(control)).toBe(false)
    }
    // The bar comes first in the document: above the frame, not after it.
    expect(bar!.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

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
    const drive = render(<DrivePanel url="about:blank" />)
    expect(frameWidth(drive.container)).toBe('1440px')
    expect(screen.getByRole('combobox', { name: 'Screen width' }).textContent).toMatch(/^1440 · \d+%$/)
    drive.unmount()
    const design = render(<DrivePanel copy="chat" url="about:blank" />)
    expect(frameWidth(design.container)).toBe('1440px')
  })

  it('takes the width the agent asked for over the remembered one, without remembering it', () => {
    localStorage.setItem('runcastle.preview.width', '768')
    const { container } = render(<DrivePanel copy="chat" url="about:blank" width={390} />)
    expect(frameWidth(container)).toBe('390px')
    expect(localStorage.getItem('runcastle.preview.width')).toBe('768')
  })

  it('fills the pane at the remembered Fit', () => {
    localStorage.setItem('runcastle.preview.width', 'fit')
    const { container } = render(<DrivePanel url="about:blank" />)
    expect(frameWidth(container)).toBe('')
    expect(screen.getByRole('combobox', { name: 'Screen width' }).textContent).toBe('Fit')
  })
})

describe('DrivePanel capture', () => {
  it('hands the crop to its caller, with nothing floating over the app', async () => {
    const onCapture = vi.fn()
    render(<DrivePanel url="about:blank" onCapture={onCapture} />)
    await selectArea()

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    expect(onCapture.mock.calls[0]![0]).toBeInstanceOf(Blob)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('offers no Select area with nowhere for the crop to go', () => {
    render(<DrivePanel url="about:blank" />)
    expect(screen.queryByRole('button', { name: 'Select area' })).toBeNull()
  })

  it('shows what it covers in the page’s place, keeps the page mounted, and puts the tools away', () => {
    const { container } = render(<DrivePanel url="about:blank" onCapture={vi.fn()} cover={<p>The API view</p>} />)
    expect(screen.getByText('The API view')).toBeTruthy()
    expect(container.querySelector('iframe')!.parentElement!.classList.contains('hidden')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })
})
