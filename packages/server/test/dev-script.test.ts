import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEV_FILTERS, devArgs, devEnv } from '../../../scripts/dev'

describe('root dev launcher', () => {
  it('starts BOTH the server and web packages', () => {
    // The bug (POSIX-VERIFICATION.md §2): a single `bun run --filter A --filter B`
    // blocks on the server's `bun --hot` and web never starts on POSIX. The fix
    // spawns each package as its own concurrent process — so both must be listed.
    expect(DEV_FILTERS).toContain('@runcastle/server')
    expect(DEV_FILTERS).toContain('@runcastle/web')
  })

  it('runs each package via its own single-filter dev command', () => {
    expect(devArgs('@runcastle/web')).toEqual(['run', '--filter', '@runcastle/web', 'dev'])
  })

  it('points dev at its own data dir, never a real install', () => {
    // Without this, `bun run dev` shares ~/.runcastle with an installed
    // runcastle, and every destructive test hits the developer's real projects.
    const env = devEnv({})
    expect(env.RUNCASTLE_DATA_DIR).toBe(join(homedir(), '.runcastle-dev'))
    expect(env.RUNCASTLE_DATA_DIR).not.toBe(join(homedir(), '.runcastle'))
    expect(env.RUNCASTLE_DEV).toBe('1')
  })

  it('keeps an explicitly-set data dir, and preserves the rest of the env', () => {
    const env = devEnv({ RUNCASTLE_DATA_DIR: '/tmp/scratch', PATH: '/usr/bin' })
    expect(env.RUNCASTLE_DATA_DIR).toBe('/tmp/scratch')
    expect(env.PATH).toBe('/usr/bin')
  })
})
