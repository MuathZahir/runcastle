import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { Context } from 'hono'

/** Files on disk over plain HTTP: what the review and thread media routes share. */

/** Size of a regular file, or `undefined` if it is missing / not a file. */
export function fileSize(path: string): number | undefined {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : undefined
  } catch {
    return undefined
  }
}

interface ByteRange {
  start: number
  end: number
}

/**
 * The single byte range a `Range` header asks for, `'unsatisfiable'` when it
 * asks past the end of the file, or `undefined` when the whole file should be
 * served.
 *
 * `undefined` is deliberately the answer to anything this route does not handle
 * — another unit, a multi-range request, a header it cannot parse — because
 * RFC 9110 lets a server ignore a Range it does not understand and reply 200.
 * Serving the whole video is always correct; only scrubbing gets slower.
 */
function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | undefined {
  const spec = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!spec) return undefined
  const [, rawStart, rawEnd] = spec
  // Nothing to hand back out of an empty file, whatever was asked for.
  if (size === 0) return 'unsatisfiable'

  if (rawStart === '') {
    // Suffix form (`bytes=-500`): the LAST n bytes. `bytes=-0` asks for nothing.
    const suffix = Number(rawEnd)
    if (rawEnd === '' || suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  // An open end, or one past the last byte, means "to the end of the file".
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

/** The slice `[start, end]` of a file, as a web stream Hono can hand back. */
export function fileStream(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
}

/**
 * A file on disk as the reply, answering the request's `Range`: a player needs
 * `Accept-Ranges` and a 206 to scrub, and a reader can ask for only the start of
 * a long file. `headers` says what the file is.
 */
export function serveFile(c: Context, path: string, size: number, headers: Record<string, string>): Response {
  const range = parseRange(c.req.header('range'), size)
  if (range === 'unsatisfiable') {
    return c.body(null, 416, { ...headers, 'accept-ranges': 'bytes', 'content-range': `bytes */${size}` })
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const reply: Record<string, string> = {
    ...headers,
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
  }
  if (range) reply['content-range'] = `bytes ${start}-${end}/${size}`
  // A file cut off before a single byte reached disk: there is nothing to stream,
  // and `createReadStream` would be asked for [0, -1]. (Any Range against it came
  // back unsatisfiable above, so this is the plain reply.)
  if (size === 0) return c.body(null, 200, reply)
  return c.body(fileStream(path, start, end), range ? 206 : 200, reply)
}
