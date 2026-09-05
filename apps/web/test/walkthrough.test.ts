import type { TestNote } from '@runcastle/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadScreenshot } from '../src/lib/reviews'
import {
  clusterMarkers,
  captureAnnotation,
  framePoint,
  paintStrokes,
  playableDuration,
  saveAnnotatedNote,
  seekTarget,
  STROKE_WIDTH,
  timestampMode,
  type Stroke,
} from '../src/lib/walkthrough'

/**
 * Video-annotation ticket 3 — the walkthrough player's logic, at the seams the
 * component only wires together: the scrub bar's span, the frame-space mapping a
 * stroke is recorded in, the compositing that bakes the PNG, and the two-step
 * save behind the Save button.
 *
 * The canvas, the video element and `fetch` are the true system boundaries here
 * and are the only things stubbed. Everything they are handed is real.
 */

/** Records what was drawn, in order — the only observable a context has. */
interface DrawLog {
  ops: string[]
  lineWidth: number
  strokeStyle: string
}

function fakeContext(): { ctx: CanvasRenderingContext2D; log: DrawLog } {
  const log: DrawLog = { ops: [], lineWidth: 0, strokeStyle: '' }
  const ctx = {
    set lineWidth(v: number) {
      log.lineWidth = v
    },
    lineCap: '',
    lineJoin: '',
    set strokeStyle(v: string) {
      log.strokeStyle = v
    },
    drawImage: (_source: unknown, x: number, y: number, w: number, h: number) =>
      log.ops.push(`drawImage(${x},${y},${w},${h})`),
    beginPath: () => log.ops.push('beginPath'),
    moveTo: (x: number, y: number) => log.ops.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => log.ops.push(`lineTo(${x},${y})`),
    stroke: () => log.ops.push('stroke'),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

/** A canvas whose `toBlob` answers with `blob` (or nothing, to fail a capture). */
function fakeCanvas(
  ctx: CanvasRenderingContext2D | null,
  blob: Blob | null,
): { canvas: HTMLCanvasElement; type: () => string | undefined } {
  let type: string | undefined
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void, mime?: string) => {
      type = mime
      cb(blob)
    },
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, type: () => type }
}

const fakeVideo = (videoWidth: number, videoHeight: number): HTMLVideoElement =>
  ({ videoWidth, videoHeight }) as unknown as HTMLVideoElement

const note = (id: string): TestNote => ({
  id,
  featureId: 'feat_1',
  lap: 1,
  text: 'the header jumps on load',
  status: 'open',
  author: 'human',
  createdAt: 1,
  updatedAt: 1,
})

describe('playableDuration', () => {
  const video = (duration: number, ranges: number[]): HTMLVideoElement =>
    ({
      duration,
      seekable: { length: ranges.length, end: (i: number) => ranges[i] },
    }) as unknown as HTMLVideoElement

  it('is the duration the element reports, when it reports one', () => {
    expect(playableDuration(video(94.5, [94.5]))).toBe(94.5)
  })

  /**
   * The case this function exists for: a WebM written by a live recorder has no
   * duration in its header, so the element answers Infinity and a scrub bar
   * built on it would have no length at all.
   */
  it('falls back to how far the recording can be seeked', () => {
    expect(playableDuration(video(Number.POSITIVE_INFINITY, [0, 61.25]))).toBe(61.25)
  })

  it('is zero while nothing has loaded yet', () => {
    expect(playableDuration(video(Number.NaN, []))).toBe(0)
  })
})

/** Video-annotation ticket 7 — jump to this moment (decisions #12). */
describe('seekTarget', () => {
  it('lands on the moment the note was taken at', () => {
    expect(seekTarget(42.5, { playable: 94.5, annotating: false })).toBe(42.5)
  })

  /**
   * A note carries no record of which recording it was taken from (decisions
   * #7), so a timestamp past the end of the one on screen is expected: it lands
   * on the last frame there is rather than erroring.
   */
  it('clamps a moment beyond the end of the recording', () => {
    expect(seekTarget(600, { playable: 94.5, annotating: false })).toBe(94.5)
  })

  /**
   * The live-recorded WebM case {@link playableDuration} exists for: the element
   * reports Infinity, the seekable range is the real length, and the jump is
   * bounded by that.
   */
  it('is bounded by how far a live-recorded WebM can be seeked', () => {
    const video = {
      duration: Number.POSITIVE_INFINITY,
      seekable: { length: 1, end: () => 61.25 },
    } as unknown as HTMLVideoElement

    expect(seekTarget(80, { playable: playableDuration(video), annotating: false })).toBe(61.25)
  })

  /** The frame must not move under an in-progress drawing (lap 1). */
  it('is inert while the human is annotating', () => {
    expect(seekTarget(12, { playable: 94.5, annotating: true })).toBeNull()
  })

  it('is inert before the recording can be seeked at all', () => {
    expect(seekTarget(12, { playable: 0, annotating: false })).toBeNull()
  })

  it('is inert for a moment that is not a number', () => {
    expect(seekTarget(Number.NaN, { playable: 94.5, annotating: false })).toBeNull()
  })

  it('never seeks before the start', () => {
    expect(seekTarget(-3, { playable: 94.5, annotating: false })).toBe(0)
  })
})

describe('framePoint', () => {
  const box = { left: 100, top: 50, width: 800, height: 450 }

  /** A player laid out at half the recording's size records full-size strokes. */
  it('maps a client point into the frame’s own pixels', () => {
    const p = framePoint(box, { width: 1600, height: 900 }, { x: 500, y: 275 })
    expect(p).toEqual({ x: 800, y: 450 })
  })

  it('puts the frame’s origin at the box’s top-left corner', () => {
    expect(framePoint(box, { width: 1600, height: 900 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('answers the origin for a box with no size, rather than NaN', () => {
    const p = framePoint({ left: 0, top: 0, width: 0, height: 0 }, { width: 800, height: 600 }, { x: 4, y: 4 })
    expect(p).toEqual({ x: 0, y: 0 })
  })
})

describe('paintStrokes', () => {
  it('draws each stroke as one red path', () => {
    const { ctx, log } = fakeContext()
    const strokes: Stroke[] = [
      [
        { x: 10, y: 10 },
        { x: 20, y: 30 },
        { x: 25, y: 35 },
      ],
    ]

    paintStrokes(ctx, strokes)

    // The literal, not the constant: the pen is the palette's failed/danger red
    // (docs/UI-SPEC.md), and asserting the constant against itself would let a
    // fresh off-palette hex through.
    expect(log.strokeStyle).toBe('#F85149')
    expect(log.lineWidth).toBe(STROKE_WIDTH)
    expect(log.ops).toEqual(['beginPath', 'moveTo(10,10)', 'lineTo(20,30)', 'lineTo(25,35)', 'stroke'])
  })

  it('leaves a dot where the pointer never moved', () => {
    const { ctx, log } = fakeContext()
    paintStrokes(ctx, [[{ x: 7, y: 9 }]])
    expect(log.ops).toEqual(['beginPath', 'moveTo(7,9)', 'lineTo(7,9)', 'stroke'])
  })

  it('draws nothing for an empty stroke list', () => {
    const { ctx, log } = fakeContext()
    paintStrokes(ctx, [[]])
    expect(log.ops).toEqual([])
  })
})

describe('captureAnnotation', () => {
  const png = new Blob([new Uint8Array([1])], { type: 'image/png' })

  it('composites the frame first and the strokes on top, at the video’s own resolution', async () => {
    const { ctx, log } = fakeContext()
    const { canvas, type } = fakeCanvas(ctx, png)

    const blob = await captureAnnotation(canvas, fakeVideo(1920, 1080), [
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    ])

    expect(blob).toBe(png)
    expect(type()).toBe('image/png')
    expect(canvas.width).toBe(1920)
    expect(canvas.height).toBe(1080)
    expect(log.ops).toEqual([
      'drawImage(0,0,1920,1080)',
      'beginPath',
      'moveTo(1,2)',
      'lineTo(3,4)',
      'stroke',
    ])
  })

  it('fails loudly when the browser hands back no PNG', async () => {
    const { ctx } = fakeContext()
    const { canvas } = fakeCanvas(ctx, null)
    await expect(captureAnnotation(canvas, fakeVideo(800, 600), [])).rejects.toThrow(/no PNG/)
  })

  it('fails loudly when there is no 2d context to draw with', async () => {
    const { canvas } = fakeCanvas(null, png)
    await expect(captureAnnotation(canvas, fakeVideo(800, 600), [])).rejects.toThrow(/2d canvas/)
  })
})

describe('saveAnnotatedNote', () => {
  it('creates the note, then attaches the PNG to the id it got back', async () => {
    const uploaded: string[] = []
    const saved = await saveAnnotatedNote({
      createNote: async () => note('note_a'),
      uploadScreenshot: async (noteId) => void uploaded.push(noteId),
    })

    expect(saved.note.id).toBe('note_a')
    expect(saved.uploadError).toBeUndefined()
    expect(uploaded).toEqual(['note_a'])
  })

  /**
   * The whole point of the two steps being ordered and unwound separately: the
   * human's words survive an upload that did not.
   */
  it('leaves the note standing when the upload fails, and says why', async () => {
    const saved = await saveAnnotatedNote({
      createNote: async () => note('note_b'),
      uploadScreenshot: () => Promise.reject(new Error('screenshot upload: 500')),
    })

    expect(saved.note.id).toBe('note_b')
    expect(saved.uploadError).toBe('screenshot upload: 500')
  })

  it('propagates a failure to create the note — there is nothing to attach to', async () => {
    let uploads = 0
    await expect(
      saveAnnotatedNote({
        createNote: () => Promise.reject(new Error('text must not be empty')),
        uploadScreenshot: async () => void uploads++,
      }),
    ).rejects.toThrow('text must not be empty')
    expect(uploads).toBe(0)
  })
})

describe('uploadScreenshot', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (response: { ok: boolean; status: number }) => {
    const calls: Array<[string, RequestInit]> = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve(response as Response)
    })
    return calls
  }

  it('posts the PNG bytes to the route keyed by the note', async () => {
    const calls = stubFetch({ ok: true, status: 200 })
    const png = new Blob([new Uint8Array([137, 80])], { type: 'image/png' })

    await uploadScreenshot('note_a', png)

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe('/api/reviews/note/note_a/screenshot')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'image/png' })
    expect(init.body).toBe(png)
  })

  it('throws with the status when the server refuses the upload', async () => {
    stubFetch({ ok: false, status: 400 })
    await expect(uploadScreenshot('note_a', new Blob([]))).rejects.toThrow('screenshot upload: 400')
  })
})

describe('recording-bound note navigation', () => {
  it('distinguishes live, earlier-walkthrough, and image-only evidence', () => {
    expect(timestampMode({ id: 'a', videoTimestamp: 42, reviewTicketId: 'review_a' }, { ticketId: 'review_a' })).toBe('live-seek')
    expect(timestampMode({ id: 'a', videoTimestamp: 42, reviewTicketId: 'review_a' }, { ticketId: 'review_b' })).toBe('orphan-label')
    expect(timestampMode({ id: 'a', videoTimestamp: null, reviewTicketId: 'review_a' }, { ticketId: 'review_a' })).toBe('png-only')
  })

  it('clusters close markers only for the recording on stage', () => {
    expect(clusterMarkers([
      { id: 'a', videoTimestamp: 2, reviewTicketId: 'review_a' },
      { id: 'b', videoTimestamp: 2.8, reviewTicketId: 'review_a' },
      { id: 'c', videoTimestamp: 4.1, reviewTicketId: 'review_a' },
      { id: 'other', videoTimestamp: 2.2, reviewTicketId: 'review_b' },
    ], 'review_a')).toEqual([{ at: 2, noteIds: ['a', 'b'] }, { at: 4.1, noteIds: ['c'] }])
  })
})
