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
const PROJECT = 'proj_Ab3-x_9QzK1m'
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
  writeFileSync(join(feature, 'base-build.log'), 'base log')
  // On NTFS these name the default data stream of the files above; elsewhere
  // they are ordinary files, so the refusal is exercised on every platform.
  writeFileSync(join(feature, 'manifest.json::$DATA'), '{}')
  writeFileSync(join(feature, 'build.log::$DATA'), 'log')
  writeFileSync(join(feature, 'base-build.log::$DATA'), 'base log')
  const base = join(root, 'base', COMMIT)
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'iframe.html'), '<html>before</html>')
  const main = join(root, 'main', PROJECT)
  mkdirSync(main, { recursive: true })
  writeFileSync(join(main, 'iframe.html'), '<html>main</html>')
  writeFileSync(join(main, 'index.json'), '{"v":5,"entries":{}}')
  for (const name of ['main.json', 'attempt.json', 'manifest.json', 'build.log', 'base-build.log']) {
    writeFileSync(join(main, name), 'private')
  }
  const attempt = join(root, 'main-attempts', PROJECT)
  mkdirSync(join(attempt, 'out-1'), { recursive: true })
  writeFileSync(join(attempt, 'out-1', 'iframe.html'), '<html>in flight</html>')
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

  it("serves main's catalogue by project, its index included", async () => {
    const res = await get(`/main/${PROJECT}/iframe.html?id=review--page&viewMode=story`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('<html>main</html>')
    expect((await get(`/main/${PROJECT}/index.json`)).status).toBe(200)
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
    ['the base build log', `/features/${FEATURE}/base-build.log`],
    ['the manifest through a stream suffix', `/features/${FEATURE}/manifest.json::$DATA`],
    ['the build log through a stream suffix', `/features/${FEATURE}/build.log::$DATA`],
    ['the base build log through a stream suffix', `/features/${FEATURE}/base-build.log::$DATA`],
    ['an encoded stream suffix', `/features/${FEATURE}/manifest.json%3A%3A$DATA`],
    ['a malformed project id', '/main/feat_abc/iframe.html'],
    ['main.json', `/main/${PROJECT}/main.json`],
    ['attempt.json', `/main/${PROJECT}/attempt.json`],
    ['a manifest beside main', `/main/${PROJECT}/manifest.json`],
    ['a build log beside main', `/main/${PROJECT}/build.log`],
    ['a base build log beside main', `/main/${PROJECT}/base-build.log`],
    ['main.json through a stream suffix', `/main/${PROJECT}/main.json::$DATA`],
    ["main's attempts", `/main-attempts/${PROJECT}/out-1/iframe.html`],
    ['an attempt through a traversal', `/main/${PROJECT}/../../main-attempts/${PROJECT}/out-1/iframe.html`],
    ['an API path', '/api/trpc/feature.list'],
    ['the root', '/'],
    ['a missing file', `/features/${FEATURE}/nope.js`],
  ])('answers 404 for %s', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(404)
  })

  // Windows 8.3 short names: on NTFS `MANIFE~1.JSO` stats as the manifest
  // itself. Linux has no aliases, so the alias is a distinct file here and an
  // injected resolver maps it to its long name, as `realpathSync.native` does.
  describe('a private file requested by its short name', () => {
    let aliased: (req: Request) => Promise<Response>
    beforeAll(() => {
      const feature = join(root, 'features', FEATURE)
      const aliases = new Map([
        [join(feature, 'MANIFE~1.JSO'), join(feature, 'manifest.json')],
        [join(feature, 'BASE-B~1.LOG'), join(feature, 'base-build.log')],
      ])
      for (const alias of aliases.keys()) writeFileSync(alias, 'private')
      aliased = createStoriesHandler(root, { realPath: (p) => aliases.get(p) ?? p })
    })

    it.each([
      ['the manifest', 'MANIFE~1.JSO'],
      ['the base build log', 'BASE-B~1.LOG'],
    ])('answers 404 for %s', async (_label, name) => {
      const res = await aliased(new Request(`http://localhost:4514/features/${FEATURE}/${name}`))
      expect(res.status).toBe(404)
    })

    it('still serves a public file', async () => {
      const res = await aliased(new Request(`http://localhost:4514/features/${FEATURE}/iframe.html`))
      expect(res.status).toBe(200)
    })
  })

  it('refuses anything but GET and HEAD', async () => {
    const res = await handle(
      new Request(`http://localhost:4514/features/${FEATURE}/iframe.html`, { method: 'POST' }),
    )
    expect(res.status).toBe(404)
  })
})
