import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStoriesHandler } from '../src/routes/stories-static'
import { rmTemp } from './helpers/fixtures'

/**
 * The stories port (decision 13): built catalogues served read-only from their
 * own origin — static files under a feature's or a base commit's build, and
 * nothing else.
 */

const FEATURE = 'feat_Ab3-x_9QzK1m'
const COMMIT = 'a'.repeat(40)
let root: string
let handle: (req: Request) => Promise<Response>

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rc-stories-'))
  const feature = join(root, 'features', FEATURE)
  mkdirSync(join(feature, 'assets'), { recursive: true })
  writeFileSync(join(feature, 'index.html'), '<html>catalogue</html>')
  writeFileSync(join(feature, 'iframe.html'), '<html>frame</html>')
  writeFileSync(join(feature, 'assets', 'preview.js'), 'export {}')
  writeFileSync(join(feature, 'manifest.json'), '{}')
  writeFileSync(join(feature, 'build.log'), 'log')
  const base = join(root, 'base', COMMIT)
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'iframe.html'), '<html>before</html>')
  writeFileSync(join(root, 'secret.txt'), 'secret')
  handle = createStoriesHandler(root)
})
afterAll(() => rmTemp(root))

const get = (path: string): Promise<Response> => handle(new Request(`http://localhost:4514${path}`))

describe('stories static handler', () => {
  it("serves a feature build's file with its MIME type and no-store", async () => {
    const res = await get(`/features/${FEATURE}/iframe.html?id=checkout--coupon&viewMode=story`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('<html>frame</html>')

    const js = await get(`/features/${FEATURE}/assets/preview.js`)
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })

  it('serves a base build by commit', async () => {
    const res = await get(`/base/${COMMIT}/iframe.html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html>before</html>')
  })

  it("serves a directory's index.html", async () => {
    const res = await get(`/features/${FEATURE}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html>catalogue</html>')
  })

  it.each([
    ['a traversal', `/features/${FEATURE}/../../secret.txt`],
    ['an encoded traversal', `/features/${FEATURE}/%2e%2e/%2e%2e/secret.txt`],
    ['an encoded-slash traversal', `/features/${FEATURE}/..%2f..%2fsecret.txt`],
    ['a malformed feature id', '/features/..%2f/secret.txt'],
    ['a non-feature id', '/features/proj_abc/iframe.html'],
    ['a short commit', '/base/aaaaaaa/iframe.html'],
    ['a non-hex commit', `/base/${'z'.repeat(40)}/iframe.html`],
    ['the manifest', `/features/${FEATURE}/manifest.json`],
    ['the build log', `/features/${FEATURE}/build.log`],
    ['an API path', '/api/trpc/feature.list'],
    ['the root', '/'],
    ['a missing file', `/features/${FEATURE}/nope.js`],
  ])('answers 404 for %s', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(404)
  })

  it('refuses anything but GET and HEAD', async () => {
    const res = await handle(
      new Request(`http://localhost:4514/features/${FEATURE}/iframe.html`, { method: 'POST' }),
    )
    expect(res.status).toBe(404)
  })
})
