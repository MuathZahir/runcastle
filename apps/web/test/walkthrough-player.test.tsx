// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The player's transport, its two honest states and its note markers
 * (decisions 23, 25b–c), tier 2: none of this is in a rendered string — it is
 * keystrokes against a `<video>` and what they do to its playhead.
 *
 * The media element is the true system boundary and the only thing stubbed
 * (decision 36); no test plays real media.
 */

const notesAdd = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({ id: 'note_1' })) }))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ notes: { list: { invalidate: vi.fn() } } }),
    notes: { add: { useMutation: () => notesAdd } },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/reviews', () => ({ uploadScreenshot: vi.fn(async () => undefined) }))

import { WalkthroughPlayer, type WalkthroughMarker } from '../src/components/WalkthroughPlayer'

const URL_ = '/api/reviews/ticket/tkt_9/walkthrough.webm'
const DURATION = 120

const play = vi.fn()
const pause = vi.fn()
const load = vi.fn()
const requestFullscreen = vi.fn()

let paused = true
let currentTime = 0
let playbackRate = 1

beforeEach(() => {
  paused = true
  currentTime = 0
  playbackRate = 1
  play.mockReset().mockImplementation(async () => {
    paused = false
  })
  pause.mockReset().mockImplementation(() => {
    paused = true
  })
  load.mockReset()
  requestFullscreen.mockReset()

  const define = (name: string, descriptor: PropertyDescriptor): void => {
    Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, ...descriptor })
  }

  define('play', { value: play })
  define('pause', { value: pause })
  define('load', { value: load })
  define('paused', { get: () => paused })
  define('duration', { get: () => DURATION })
  define('seekable', { get: () => ({ length: 0, end: () => 0 }) })
  define('videoWidth', { get: () => 1920 })
  define('videoHeight', { get: () => 1080 })
  define('currentTime', { get: () => currentTime, set: (v: number) => void (currentTime = v) })
  define('playbackRate', { get: () => playbackRate, set: (v: number) => void (playbackRate = v) })
  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ headers: { get: () => '21000000' } })),
  )

  // The overlay's canvas: the annotation surface has its own test file, so here
  // it only has to not be the thing that fails a save.
  const noop = (): void => undefined
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: noop,
    drawImage: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    stroke: noop,
  } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    ;(cb as (b: Blob | null) => void)(new Blob([new Uint8Array([1])], { type: 'image/png' }))
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount(
  props: {
    readonly?: boolean
    markers?: WalkthroughMarker[]
    onMarkerClick?: (noteIds: string[]) => void
    onAnnotationSaved?: (noteId: string) => void
  } = {},
): HTMLVideoElement {
  render(
    <WalkthroughPlayer
      url={URL_}
      featureId="feat_1"
      ticketId="tkt_9"
      passKind="review"
      readonly={props.readonly ?? false}
      markers={props.markers}
      onMarkerClick={props.onMarkerClick}
      onAnnotationSaved={props.onAnnotationSaved}
    />,
  )
  return screen.getByLabelText('review walkthrough') as HTMLVideoElement
}

/** The recording has loaded and is playable — the state most tests start in. */
function ready(props: Parameters<typeof mount>[0] = {}): HTMLVideoElement {
  const video = mount(props)
  fireEvent.loadedMetadata(video)
  fireEvent.canPlay(video)
  return video
}

const key = (k: string): void => void fireEvent.keyDown(document.body, { key: k })

describe('WalkthroughPlayer transport', () => {
  it('toggles with Space, K and a click on the frame', () => {
    const video = ready()

    key(' ')
    expect(play).toHaveBeenCalledOnce()
    fireEvent.play(video)

    key('k')
    expect(pause).toHaveBeenCalledOnce()
    fireEvent.pause(video)

    fireEvent.click(video)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('jumps five seconds with J/L and the arrows', () => {
    const video = ready()

    video.currentTime = 30
    key('ArrowRight')
    expect(video.currentTime).toBe(35)

    key('ArrowLeft')
    expect(video.currentTime).toBe(30)

    key('l')
    key('j')
    key('j')
    expect(video.currentTime).toBe(25)
  })

  it('steps one frame with , and . while paused, and not while playing', () => {
    const video = ready()
    video.currentTime = 30

    key('.')
    expect(video.currentTime).toBeCloseTo(30 + 1 / 30, 5)
    key(',')
    expect(video.currentTime).toBeCloseTo(30, 5)

    // Under a running playhead a thirtieth of a second lands nowhere.
    key(' ')
    fireEvent.play(video)
    video.currentTime = 50
    key('.')
    expect(video.currentTime).toBe(50)
  })

  it('opens at 1.5× and cycles the speed with < and >', () => {
    const video = ready()
    expect(video.playbackRate).toBe(1.5)
    expect(screen.getByRole('button', { name: 'playback speed 1.5×' })).toBeTruthy()

    key('>')
    expect(video.playbackRate).toBe(1.75)

    key('<')
    key('<')
    expect(video.playbackRate).toBe(1.25)
    expect(screen.getByRole('button', { name: 'playback speed 1.25×' })).toBeTruthy()
  })

  it('goes fullscreen on F', () => {
    ready()
    key('f')
    expect(requestFullscreen).toHaveBeenCalledOnce()
  })

  // The keys belong to the player only when the human is not typing somewhere.
  it('leaves keystrokes alone while a field has the focus', () => {
    ready()
    const field = document.createElement('input')
    document.body.append(field)

    fireEvent.keyDown(field, { key: ' ' })
    expect(play).not.toHaveBeenCalled()
    field.remove()
  })

  it('scrubs in whole seconds and previews the moment under the pointer', () => {
    ready()
    const slider = screen.getByLabelText('scrub the walkthrough') as HTMLInputElement
    expect(slider.step).toBe('1')
    expect(slider.max).toBe(String(DURATION))

    const track = slider.parentElement!
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect)
    fireEvent.mouseMove(track, { clientX: 25 })

    expect(screen.getByText('0:30')).toBeTruthy()
  })

  // Walkthroughs carry no audio worth controlling (decision 23a).
  it('offers no volume or mute control', () => {
    ready()
    expect(screen.queryByLabelText(/volume|mute/i)).toBeNull()
  })
})

describe('WalkthroughPlayer states', () => {
  it('says it is loading, and how big the file is, until it can play', async () => {
    const video = mount()
    expect(screen.getByText('Loading the recording')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('Loading the recording — 21 MB')).toBeTruthy())
    // Visibly loading, not dead.
    expect((screen.getByLabelText('scrub the walkthrough') as HTMLInputElement).disabled).toBe(true)

    fireEvent.loadedMetadata(video)
    fireEvent.canPlay(video)
    expect(screen.queryByText(/Loading the recording/)).toBeNull()
  })

  it('names a recording it cannot decode, and offers a retry', () => {
    const video = mount()
    fireEvent.error(video)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('This recording can’t be played')
    expect(alert.textContent).toContain(URL_)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(load).toHaveBeenCalledOnce()
    expect(screen.getByText(/Loading the recording/)).toBeTruthy()
  })
})

describe('WalkthroughPlayer notes', () => {
  const markers: WalkthroughMarker[] = [
    { at: 30, noteIds: ['note_a'] },
    { at: 60, noteIds: ['note_b', 'note_c', 'note_d'] },
  ]

  it('marks each moment on the scrub bar and counts a cluster', () => {
    ready({ markers })

    expect(screen.getByRole('button', { name: '1 note at 0:30' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: '3 notes at 1:00' }).textContent).toBe('3')
  })

  it('seeks to a marker and tells the list which notes it was', () => {
    const onMarkerClick = vi.fn()
    const video = ready({ markers, onMarkerClick })

    fireEvent.click(screen.getByRole('button', { name: '3 notes at 1:00' }))

    expect(video.currentTime).toBe(60)
    // A jump stops there: the human clicked to look at that frame.
    expect(pause).toHaveBeenCalled()
    expect(onMarkerClick).toHaveBeenCalledWith(['note_b', 'note_c', 'note_d'])
  })

  it('keeps the markers but drops Annotate on a shipped feature', () => {
    ready({ markers, readonly: true })

    expect(screen.getByRole('button', { name: '1 note at 0:30' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull()
  })
})

describe('WalkthroughPlayer annotation', () => {
  // The walked pattern this redesign removes: a greyed control with a tooltip
  // telling the human what they should have done first (decision 24a).
  it('is never disabled, and pauses on the frame as it opens', () => {
    const video = ready()
    key(' ')
    fireEvent.play(video)
    video.currentTime = 42

    const annotate = screen.getByRole('button', { name: 'Annotate' }) as HTMLButtonElement
    expect(annotate.disabled).toBe(false)

    fireEvent.click(annotate)
    expect(pause).toHaveBeenCalled()
    expect(screen.getByLabelText('draw on this frame')).toBeTruthy()
  })

  it('binds a saved annotation to the recording it was drawn on', async () => {
    const onAnnotationSaved = vi.fn()
    const video = ready({ onAnnotationSaved })
    video.currentTime = 42
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the header jumps' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /save note/i })))

    expect(notesAdd.mutateAsync).toHaveBeenCalledWith({
      featureId: 'feat_1',
      text: 'the header jumps',
      videoTimestamp: 42,
      reviewTicketId: 'tkt_9',
    })
    expect(onAnnotationSaved).toHaveBeenCalledWith('note_1')
    expect(screen.queryByLabelText('draw on this frame')).toBeNull()
  })

  it('gives a drawing-only note the moment it was taken from as its text', async () => {
    const video = ready()
    video.currentTime = 42
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }))

    const canvas = screen.getByLabelText('draw on this frame')
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /save note/i })))

    expect(notesAdd.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Annotated 0:42', reviewTicketId: 'tkt_9' }),
    )
  })
})
