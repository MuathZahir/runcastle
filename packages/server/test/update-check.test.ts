import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkForUpdate, compareSemver } from '../src/services/update-check'
import { UNKNOWN_VERSION } from '../src/version'

/**
 * Issue #51 — the server checks for a newer published version on boot and
 * surfaces a dismissible update banner. The fetch is injected so the compare +
 * banner wiring is tested without touching the network: latest > running ⇒
 * update available with the exact update command; any failure is swallowed
 * (a stranger offline must still boot), never auto-installing anything.
 *
 * The check is also the usage signal: it pings runcastle's own endpoint with an
 * anonymous install ID first, and the ladder below (ping → npm → silence) is
 * what keeps the banner working when that endpoint is down or opted out of.
 */
describe('compareSemver', () => {
  it('orders by numeric major/minor/patch, not lexically', () => {
    expect(compareSemver('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a prerelease below its release', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.1')).toBeGreaterThan(0)
  })

  it('tolerates a leading v and stray whitespace', () => {
    expect(compareSemver(' v1.2.0 ', '1.2.0')).toBe(0)
  })
})

// The two rungs of the ladder, pinned as literals rather than imported from the
// service — the URLs a stranger's machine talks to are part of the contract.
const PING = 'https://ping.runcastle.dev/ping'
const NPM = 'https://registry.npmjs.org/runcastle/latest'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call {
  url: string
  method: string
  body: unknown
}

/** A fetch stub that records every request and answers per URL. */
function spyFetch(answer: (url: string) => Response | Promise<Response>): {
  impl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const impl = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return answer(url)
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** Both rungs healthy, each answering in its own response shape. */
function fetchReturning(version: string): typeof fetch {
  return spyFetch((url) => (url === NPM ? json({ version }) : json({ latest: version }))).impl
}

describe('checkForUpdate', () => {
  // The ping carries an install ID read-or-created under the data dir; pin it at
  // a temp tree so the suite never writes to a real `~/.runcastle/`.
  let previousDataDir: string | undefined

  beforeEach(() => {
    previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'runcastle-update-'))
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
  })

  it('reports an update when latest > running, naming the exact command', async () => {
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: fetchReturning('0.2.0') })
    expect(info.updateAvailable).toBe(true)
    expect(info.current).toBe('0.1.0')
    expect(info.latest).toBe('0.2.0')
    expect(info.command).toBe('bun add -g runcastle@latest')
  })

  it('reports no update when running is current or ahead', async () => {
    expect((await checkForUpdate({ current: '0.2.0', fetchImpl: fetchReturning('0.2.0') })).updateAvailable).toBe(false)
    expect((await checkForUpdate({ current: '0.3.0', fetchImpl: fetchReturning('0.2.0') })).updateAvailable).toBe(false)
  })

  it('asks runcastle first, POSTing the install ID, version and platform — nothing else', async () => {
    const spy = spyFetch(() => json({ latest: '9.9.9' }))
    await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: {} })

    expect(spy.calls).toHaveLength(1)
    const [call] = spy.calls
    expect(call?.url).toBe(PING)
    expect(call?.method).toBe('POST')
    expect(call?.body).toEqual({
      installId: expect.stringMatching(UUID_RE),
      version: '0.1.0',
      platform: process.platform,
    })
  })

  it('sends the same install ID on every check', async () => {
    const spy = spyFetch(() => json({ latest: '9.9.9' }))
    await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: {} })
    await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: {} })
    const ids = spy.calls.map((c) => (c.body as { installId: string }).installId)
    expect(ids[0]).toBe(ids[1])
  })

  it("drives the banner off runcastle's { latest } answer", async () => {
    const info = await checkForUpdate({
      current: '0.1.0',
      fetchImpl: spyFetch(() => json({ latest: '0.4.0' })).impl,
      env: {},
    })
    expect(info.latest).toBe('0.4.0')
    expect(info.updateAvailable).toBe(true)
    expect(info.command).toBe('bun add -g runcastle@latest')
  })

  // The banner is the user-facing feature and the ping is the freeloader: an
  // endpoint outage costs a week of signal, never a user's update notification.
  it.each([
    ['a non-2xx', () => json({ latest: '0.4.0' }, 503)],
    ['a thrown request', () => Promise.reject(new Error('dns'))],
    ['a body with no latest', () => json({ nope: true })],
    ['a non-string latest', () => json({ latest: 42 })],
  ])('falls back to npm on %s from runcastle', async (_label, broken) => {
    const spy = spyFetch((url) => (url === PING ? broken() : json({ version: '0.4.0' })))
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: {} })

    expect(spy.calls.map((c) => c.url)).toEqual([PING, NPM])
    expect(spy.calls[1]?.method).toBe('GET')
    expect(info.latest).toBe('0.4.0')
    expect(info.updateAvailable).toBe(true)
  })

  it('degrades to a silent no-update when both rungs fail, without throwing', async () => {
    const spy = spyFetch(() => Promise.reject(new Error('offline')))
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: {} })

    expect(spy.calls.map((c) => c.url)).toEqual([PING, NPM])
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })

  it('swallows a network error — offline boot never blocks or claims an update', async () => {
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: boom })
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })

  // DO_NOT_TRACK is the whole opt-out surface, and it must not punish: an
  // opted-out install still gets its update banner, straight from npm.
  it('skips the ping entirely when DO_NOT_TRACK is set, asking npm directly', async () => {
    const spy = spyFetch(() => json({ version: '0.4.0' }))
    const info = await checkForUpdate({
      current: '0.1.0',
      fetchImpl: spy.impl,
      env: { DO_NOT_TRACK: '1' },
    })

    expect(spy.calls.map((c) => c.url)).toEqual([NPM])
    expect(spy.calls.every((c) => c.method === 'GET')).toBe(true)
    expect(spy.calls.every((c) => c.body === undefined)).toBe(true)
    expect(info.latest).toBe('0.4.0')
    expect(info.updateAvailable).toBe(true)
  })

  it('treats an empty or 0 DO_NOT_TRACK as not opted out', async () => {
    for (const value of ['', '0']) {
      const spy = spyFetch(() => json({ latest: '0.4.0' }))
      await checkForUpdate({ current: '0.1.0', fetchImpl: spy.impl, env: { DO_NOT_TRACK: value } })
      expect(spy.calls.map((c) => c.url)).toEqual([PING])
    }
  })

  // An unreadable manifest leaves the running version as UNKNOWN_VERSION, which
  // every published release outranks — so a brand-new install was told it was on
  // 0.0.0 and out of date, from a prompt it had no reason to trust (findings F7).
  // ...and it makes no request at all: an unversioned build has nothing to ask
  // about, so it must not ping either.
  it('claims no update when the running version is unknown, without any request', async () => {
    const spy = spyFetch(() => json({ latest: '1.1.1' }))
    const info = await checkForUpdate({ current: UNKNOWN_VERSION, fetchImpl: spy.impl, env: {} })

    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
    expect(spy.calls).toEqual([])
  })

  it('swallows a non-200 from both rungs', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: notFound })
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })
})
