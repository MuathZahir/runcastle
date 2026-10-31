import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Hono } from 'hono'
import { IMAGE_TYPES, threadImagePath } from '../threads/images'
import { SHOWN_TYPES, shownFilePath } from '../threads/shown'
import { fileSize, serveFile } from './media'

/**
 * Thread media over plain HTTP (chat-as-web-components; ADR-0015): the images
 * sent with a thread's prompts, which its log names by URL and the thread shows
 * in an `<img>`, and the files agents showed. Read-only: the agent host writes
 * the images as the prompt is sent, and `show_file` writes the files. Mounted at
 * `/api/threads`.
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

/**
 * GET /api/threads/:threadId/files/:file — one copy an agent showed. Only a type
 * a browser shows as media is served inline. Everything else, HTML above all, is
 * bytes to download: this server has no login and can start merges, so nothing an
 * agent wrote may run at its address. The viewer reads those bytes with `fetch`,
 * which pays the headers no mind. `?download=<name>` saves any copy under its name.
 */
threads.get('/:threadId/files/:file', (c) => {
  const path = shownFilePath(c.req.param('threadId'), c.req.param('file'))
  if (!path) return c.notFound()
  const size = fileSize(path)
  if (size === undefined) return c.notFound()
  const ext = extname(path).slice(1)
  const type = SHOWN_TYPES[ext]
  const name = c.req.query('download')
  const headers: Record<string, string> = {
    'content-type': type ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  }
  if (name !== undefined || !type) {
    headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name || `file.${ext}`)}`
  }
  // An SVG opened on its own is a document, and its scripts would run here.
  if (ext === 'svg') headers['content-security-policy'] = 'sandbox'
  return serveFile(c, path, size, headers)
})

export default threads
