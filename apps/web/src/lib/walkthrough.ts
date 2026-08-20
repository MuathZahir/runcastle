import type { TestNote } from '@runcastle/core'

/**
 * The walkthrough player's logic, kept out of the component: what the scrub bar
 * spans, where a pointer landed in the frame, how strokes are painted, how the
 * annotated frame is baked into a PNG, and the two steps a save takes.
 *
 * The component is then only wiring — which matters here because none of this is
 * reachable from a rendered tree in this repo's test setup, and the capture is
 * the one part of the feature with no server-side seam behind it.
 */

/**
 * A point in the video's OWN pixel space, never in layout pixels (decisions #6).
 * Drawing at the intrinsic resolution is what makes the captured PNG full
 * quality no matter how small the player is rendered.
 */
export interface Point {
  x: number
  y: number
}

/** One freehand stroke: the points a pointer travelled through, in frame space. */
export type Stroke = readonly Point[]

/**
 * Red, and only red (decisions #6) — one high-visibility pen, no palette
 * choice. The hex is the palette's own failed/danger red (docs/UI-SPEC.md), not
 * a fresh one: lap 1 picked a more saturated `#ff2b2b` by hand, and a one-off
 * hex in a lib file is how a pinned palette stops being exhaustive.
 */
export const STROKE_COLOR = '#F85149'

/**
 * Stroke width in frame pixels. Wide enough to survive the downscale to the
 * player's layout size and the thumbnail below it — a hairline drawn at 1920px
 * wide is invisible at 200px.
 */
export const STROKE_WIDTH = 4

/**
 * How long the scrub bar is allowed to be, in seconds.
 *
 * `duration` alone is not enough: the walkthroughs are recorded by the review
 * agent's browser, and a WebM written by a live recorder carries no duration in
 * its header — the element reports `Infinity` until the whole file has been
 * read. What it does know is how much it can seek to, so that is the fallback,
 * and it grows as the file loads.
 */
export function playableDuration(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  const { seekable } = video
  return seekable.length > 0 ? seekable.end(seekable.length - 1) : 0
}

/**
 * Where a pointer event landed, in frame pixels. The canvas is sized to the
 * video's intrinsic resolution and scaled down by CSS, so every client
 * coordinate has to be mapped back through that scale before it is a stroke.
 */
export function framePoint(
  box: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  client: { x: number; y: number },
): Point {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((client.x - box.left) / box.width) * frame.width,
    y: ((client.y - box.top) / box.height) * frame.height,
  }
}

/**
 * Paint strokes onto a context — the overlay while drawing, and the capture
 * canvas at save. One function for both, so what the human drew and what the
 * PNG carries cannot drift apart.
 *
 * Does not clear: the overlay clears itself before repainting, and the capture
 * paints over the frame it just drew.
 */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]): void {
  ctx.lineWidth = STROKE_WIDTH
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = STROKE_COLOR

  for (const stroke of strokes) {
    const [first, ...rest] = stroke
    if (!first) continue
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    // A tap that never moved is still a mark the human made: a zero-length line
    // under a round cap draws the dot they were pointing at.
    if (rest.length === 0) ctx.lineTo(first.x, first.y)
    for (const point of rest) ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }
}

/**
 * The paused frame with the strokes baked into it, as PNG bytes (decisions #3).
 *
 * Frame first, strokes second, on one canvas sized to the video's intrinsic
 * resolution: the artifact is what the human saw plus what they drew on it, at
 * full quality. The video is served same-origin from `/api/reviews`, so the
 * canvas is untainted and `toBlob` is allowed to read it back.
 *
 * The canvas is passed in rather than created here so the caller owns its
 * lifetime — and so this is drivable without a DOM.
 */
export async function captureAnnotation(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  strokes: readonly Stroke[],
): Promise<Blob> {
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser offered no 2d canvas to capture the frame with')

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  paintStrokes(ctx, strokes)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('the browser produced no PNG from the annotated frame'))
    }, 'image/png')
  })
}

/** A saved annotation: the note that now exists, and how its PNG fared. */
export interface SavedAnnotation {
  note: TestNote
  /** Why the screenshot did not land, when it did not. The note stands either way. */
  uploadError?: string
}

/**
 * The save, in the only order it can happen: the note first, because the PNG is
 * keyed by the note's id, then the PNG.
 *
 * A failed upload is reported, never rolled back. The human typed an
 * observation; a note that arrives without its picture is a worse note, but
 * deleting it to keep the two in lockstep would throw away the part they wrote
 * by hand. Note creation failing is a different matter and propagates — there is
 * nothing to attach a screenshot to.
 */
export async function saveAnnotatedNote(steps: {
  createNote: () => Promise<TestNote>
  uploadScreenshot: (noteId: string) => Promise<unknown>
}): Promise<SavedAnnotation> {
  const note = await steps.createNote()
  try {
    await steps.uploadScreenshot(note.id)
    return { note }
  } catch (e) {
    return { note, uploadError: e instanceof Error ? e.message : String(e) }
  }
}
