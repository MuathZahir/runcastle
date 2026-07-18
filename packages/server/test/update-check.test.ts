import { describe, expect, it } from 'vitest'
import { checkForUpdate, compareSemver } from '../src/services/update-check'

/**
 * Issue #51 — the server checks npm's `latest` dist-tag on start and surfaces a
 * dismissible update banner. The fetch is injected so the compare + banner
 * wiring is tested without touching the network: latest > running ⇒ update
 * available with the exact update command; any registry failure is swallowed
 * (a stranger offline must still boot), never auto-installing anything.
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

/** A fetch stub that returns the npm `/<pkg>/latest` manifest. */
function fetchReturning(version: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ version }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('checkForUpdate', () => {
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

  it('queries the npm registry latest dist-tag for the package', async () => {
    let seen = ''
    const spy = (async (url: string) => {
      seen = url
      return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
    }) as unknown as typeof fetch
    await checkForUpdate({ current: '0.1.0', fetchImpl: spy })
    expect(seen).toBe('https://registry.npmjs.org/runcastle/latest')
  })

  it('swallows a network error — offline boot never blocks or claims an update', async () => {
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: boom })
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })

  it('swallows a non-200 registry response', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    const info = await checkForUpdate({ current: '0.1.0', fetchImpl: notFound })
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })
})
