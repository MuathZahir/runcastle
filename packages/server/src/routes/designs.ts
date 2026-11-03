import { extname } from 'node:path'
import { Hono } from 'hono'
import { designPicturePath } from '../services/designs'
import { SHOWN_TYPES } from '../threads/shown'
import { fileSize, serveFile } from './media'

/**
 * Design pictures over plain HTTP: runcastle's own copy of the picture an agent
 * passed to `show_design`, which the design cards and the Design tab's list show
 * in an `<img>`. Read-only, and only ever a name the record minted. Mounted at
 * `/api/designs`.
 */
const designsApp = new Hono()

/** GET /api/designs/:featureId/pictures/:file — one design's picture. */
designsApp.get('/:featureId/pictures/:file', (c) => {
  const path = designPicturePath(c.req.param('featureId'), c.req.param('file'))
  if (!path) return c.notFound()
  const size = fileSize(path)
  if (size === undefined) return c.notFound()
  const ext = extname(path).slice(1)
  const headers: Record<string, string> = {
    'content-type': SHOWN_TYPES[ext] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  }
  // An SVG opened on its own is a document, and its scripts would run here.
  if (ext === 'svg') headers['content-security-policy'] = 'sandbox'
  return serveFile(c, path, size, headers)
})

export default designsApp
