import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { resetUpdateCache } from '../src/services/update-check'
import { runcastleVersion } from '../src/version'

/**
 * Issue #51 — the server exposes its running version and an update check over
 * tRPC so the SPA can render the dismissible update banner. The npm fetch is
 * stubbed here so the router wiring is tested without the network.
 */
const pkgVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).version as string

// A minimal ctx — the system router touches neither db nor config.
const caller = createCallerFactory(appRouter)({} as never)

afterEach(() => {
  resetUpdateCache()
  vi.unstubAllGlobals()
})

describe('runcastleVersion', () => {
  it('reads the running version from the server package.json', () => {
    expect(runcastleVersion()).toBe(pkgVersion)
  })
})

describe('system router', () => {
  it('reports the running version', async () => {
    expect(await caller.system.version()).toEqual({ version: pkgVersion })
  })

  // Wiring only: the route reports the version it is actually running and the
  // exact command. Whether that version is BEHIND is `checkForUpdate`'s call —
  // including the unknown-version case this checkout happens to be in, whose own
  // manifest reads 0.0.0 (findings F7).
  it('reports the running version and the exact update command', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: '999.0.0' }), { status: 200 })),
    )
    const info = await caller.system.checkUpdate()
    expect(info.current).toBe(pkgVersion)
    expect(info.command).toBe('bun add -g runcastle@latest')
  })

  it('never throws when the registry is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const info = await caller.system.checkUpdate()
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBeNull()
  })
})
