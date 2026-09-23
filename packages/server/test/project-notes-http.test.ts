import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import reviewsApp from '../src/routes/reviews'
import { addNote } from '../src/services/project-notes'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x42])

describe('project note screenshot routes', () => {
  let ctx: AppCtx
  let projectId: string
  let temp: string
  let restore: () => void
  const mount = () => { const app = new Hono(); app.route('/api/reviews', reviewsApp); return app }
  const upload = (id: string) => `/api/reviews/project-note/${id}/screenshot`
  const image = (id: string) => `${upload(id)}.png`

  beforeEach(async () => {
    temp = mkdtempSync(join(tmpdir(), 'project-note-http-'))
    restore = useDataDir(temp)
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    setRuntimeCtx(ctx)
  })
  afterEach(() => { clearRuntimeCtx(); restore(); rmSync(temp, { recursive: true, force: true }) })

  it('rejects non-PNG bytes and round-trips PNG bytes', async () => {
    const note = addNote(ctx, projectId, 'screenshot')
    expect((await mount().request(upload(note.id), { method: 'POST', body: new Uint8Array([1]) })).status).toBe(400)
    expect((await mount().request(upload(note.id), { method: 'POST', body: PNG })).status).toBe(200)
    const response = await mount().request(image(note.id))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('404s for unknown note ids on upload and download', async () => {
    expect((await mount().request(upload('pnote_nope'), { method: 'POST', body: PNG })).status).toBe(404)
    expect((await mount().request(image('pnote_nope'))).status).toBe(404)
  })
})
