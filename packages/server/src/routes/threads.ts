import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Hono } from 'hono'
import { IMAGE_TYPES, threadImagePath } from '../threads/images'

/**
 * Thread media over plain HTTP (chat-as-web-components; ADR-0015): the images
 * sent with a thread's prompts, which its log names by URL and the thread shows
 * in an `<img>`. Read-only — the images are written by the agent host as the
 * prompt is sent. Mounted at `/api/threads`.
 */
const threads = new Hono()

/** GET /api/threads/:threadId/images/:file — one sent image. */
threads.get('/:threadId/images/:file', (c) => {
  const path = threadImagePath(c.req.param('threadId'), c.req.param('file'))
  if (!path) return c.notFound()
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return c.notFound()
  }
  const type = IMAGE_TYPES[extname(path).slice(1)]
  return c.body(new Uint8Array(bytes), 200, { 'content-type': type, 'content-length': String(bytes.length) })
})

export default threads
