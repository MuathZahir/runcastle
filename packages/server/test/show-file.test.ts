import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldThread, type ShownFile } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolReadFeatureChat } from '../src/mcp/orchestrator-run-tools'
import mcpApp, { toolsForAudience } from '../src/mcp/server'
import threads from '../src/routes/threads'
import { readThreadEvents } from '../src/threads/log'
import { SHOWN_MAX_BYTES, showFile, sortFile } from '../src/threads/shown'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/** `show_file`, called as the MCP handler calls it, and the route that serves what it copied. */

describe('show_file', () => {
  let ctx: AppCtx
  let repo: string
  let session: ReturnType<typeof createSessionRow>
  let projectId: string
  let featureSlug: string
  const app = new Hono().route('/api/threads', threads)
  const saved = ['RUNCASTLE_DATA_DIR', 'TMPDIR', 'TEMP', 'TMP'].map((key) => [key, process.env[key]] as const)
  let base: string

  beforeEach(async () => {
    // The system temp folder is an allowed place, so everything these tests must
    // find refused has to sit outside the one the code under test sees.
    base = mkdtempSync(join(tmpdir(), 'rc-show-'))
    mkdirSync(join(base, 'temp'))
    process.env.RUNCASTLE_DATA_DIR = join(base, 'data')
    for (const key of ['TMPDIR', 'TEMP', 'TMP']) process.env[key] = join(base, 'temp')
    ctx = await makeTestCtx()
    repo = tmpRepo()
    const project = seedProject(ctx, repo)
    projectId = project.id
    const feature = seedFeature(ctx, project.id)
    featureSlug = feature.slug
    session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo } as never)
  })

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const write = (name: string, body: string | Uint8Array = 'hello') => {
    const path = join(repo, name)
    writeFileSync(path, body)
    return path
  }

  const shown = (): ShownFile[] =>
    readThreadEvents(session.id).flatMap((e) => (e.type === 'file_shown' ? [e.file] : []))

  it('is offered to every session with a thread, and not to a sandboxed worker', () => {
    for (const kind of ['chat', 'side', 'scenario', 'drive-fix', 'project'] as const) {
      expect(toolsForAudience(kind), kind).toContain('show_file')
    }
    expect(toolsForAudience('worker')).not.toContain('show_file')
  })

  it('copies the file into the thread and logs it, and the copy outlives the original', async () => {
    const path = write('shot.png', 'bytes')
    expect(showFile(ctx, session, { path: 'shot.png', caption: '  The empty\nstate ' })).toEqual({ shown: true, name: 'shot.png', as: 'image' })
    const [file] = shown()
    expect(file).toMatchObject({ name: 'shot.png', path: 'shot.png', size: 5, as: 'image', caption: 'The empty state' })
    expect(foldThread(readThreadEvents(session.id)).items).toMatchObject([{ kind: 'shown', files: [{ id: file.id }] }])
    writeFileSync(path, 'changed')
    const res = await app.request(file.src)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('bytes')
  })

  it('works over the real MCP route, and a refusal reaches the agent as its error', async () => {
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
    const mcp = new Hono().route('/mcp', mcpApp)
    const call = async (path: string) => {
      const res = await mcp.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-Runcastle-Session': session.id },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_file', arguments: { path } } }),
      })
      return ((await res.json()) as { result: { isError?: boolean; content: [{ text: string }] } }).result
    }
    try {
      write('report.md', '# Done')
      expect(JSON.parse((await call('report.md')).content[0].text)).toEqual({ shown: true, name: 'report.md', as: 'markdown' })
      const refused = await call('nope.md')
      expect(refused.isError).toBe(true)
      expect(refused.content[0].text).toContain('there is no file at')
    } finally {
      clearRuntimeCtx()
    }
  })

  it('sorts a file by what it is', () => {
    const none = new Uint8Array()
    expect(sortFile('png', none)).toBe('image')
    expect(sortFile('svg', none)).toBe('image')
    expect(sortFile('pdf', none)).toBe('browser')
    expect(sortFile('webm', none)).toBe('browser')
    expect(sortFile('md', none)).toBe('markdown')
    expect(sortFile('html', none)).toBe('html')
    expect(sortFile('prisma', new TextEncoder().encode('model User {}'))).toBe('text')
    expect(sortFile('bin', Uint8Array.from([1, 0, 2]))).toBe('download')
  })

  it('refuses a missing file, a folder, a file too big, and leaves nothing behind', () => {
    mkdirSync(join(repo, 'dir'))
    const big = write('big.log')
    truncateSync(big, SHOWN_MAX_BYTES + 1)
    expect(() => showFile(ctx, session, { path: 'nope.png' })).toThrow(GateError)
    expect(() => showFile(ctx, session, { path: 'dir' })).toThrow(/not a file/)
    expect(() => showFile(ctx, session, { path: 'big.log' })).toThrow(/at most 100 MB/)
    expect(shown()).toEqual([])
    expect(existsSync(join(sessionDir(session.id), 'shown'))).toBe(false)
  })

  it('refuses a path outside the allowed places, and a link pointing out of them', () => {
    const secret = join(base, 'id_rsa')
    writeFileSync(secret, 'key')
    expect(() => showFile(ctx, session, { path: secret })).toThrow(/outside the places/)
    expect(shown()).toEqual([])
    let linked = true
    try {
      symlinkSync(secret, join(repo, 'link'))
    } catch {
      // Windows needs a privilege for this; the real-path check is the same either way.
      linked = false
    }
    if (linked) expect(() => showFile(ctx, session, { path: 'link' })).toThrow(/outside the places/)
  })

  it('shows a file from the temp folder under its full path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-shot-'))
    const path = join(dir, 'capture.png')
    writeFileSync(path, 'png')
    showFile(ctx, session, { path })
    expect(shown()[0]).toMatchObject({ name: 'capture.png', path })
  })

  it('tells the orchestrator what a chat showed, and the copy shows again from another thread', () => {
    write('shot.png', 'bytes')
    showFile(ctx, session, { path: 'shot.png', caption: 'The dialog' })
    const orchestrator = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repo } as never)
    const { shown: copies } = toolReadFeatureChat(ctx, orchestrator, { slug: featureSlug })
    expect(copies).toMatchObject([{ name: 'shot.png', caption: 'The dialog' }])
    expect(readFileSync(copies[0].path, 'utf8')).toBe('bytes')
    expect(showFile(ctx, orchestrator, { path: copies[0].path })).toMatchObject({ as: 'image' })
  })

  describe('the route', () => {
    it('serves media inline, and a page never as a page', async () => {
      write('report.html', '<script>alert(1)</script>')
      write('shot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
      showFile(ctx, session, { path: 'report.html' })
      showFile(ctx, session, { path: 'shot.svg' })
      const [html, svg] = shown()

      const page = await app.request(html.src)
      expect(page.headers.get('content-type')).toBe('application/octet-stream')
      expect(page.headers.get('content-disposition')).toMatch(/^attachment/)
      expect(page.headers.get('x-content-type-options')).toBe('nosniff')

      const image = await app.request(svg.src)
      expect(image.headers.get('content-type')).toBe('image/svg+xml')
      expect(image.headers.get('content-disposition')).toBeNull()
      expect(image.headers.get('content-security-policy')).toBe('sandbox')
    })

    it('saves a file under its name, and gives a viewer the start of a long one', async () => {
      write('notes.log', 'abcdefghij')
      showFile(ctx, session, { path: 'notes.log' })
      const [file] = shown()
      const saved = await app.request(`${file.src}?download=${encodeURIComponent(file.name)}`)
      expect(saved.headers.get('content-disposition')).toContain('notes.log')
      const start = await app.request(file.src, { headers: { range: 'bytes=0-3' } })
      expect(start.status).toBe(206)
      expect(await start.text()).toBe('abcd')
    })

    it('answers 404 for any name the store would not write', async () => {
      write('shot.png')
      showFile(ctx, session, { path: 'shot.png' })
      const base = `/api/threads/${session.id}/files`
      for (const name of ['nothing.png', '..%2F..%2Fthread.jsonl', '..%5Cthread.jsonl', 'thread.jsonl.', 'a%2Fb.png']) {
        expect((await app.request(`${base}/${name}`)).status, name).toBe(404)
      }
    })
  })
})
