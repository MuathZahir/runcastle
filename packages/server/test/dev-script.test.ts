import { describe, expect, it } from 'vitest'
import { DEV_FILTERS, devArgs } from '../../../scripts/dev'

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
})
