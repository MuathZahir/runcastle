import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/launcher'

describe('resolvePluginDir', () => {
  it('resolves the real runcastle plugin dir from the module location', () => {
    const dir = resolvePluginDir()
    expect(existsSync(dir)).toBe(true)
    expect(dir.endsWith(join('packages', 'skills', 'packs', 'runcastle'))).toBe(true)
  })

  it('throws a loud error naming the searched locations when nothing is found', () => {
    const empty = mkdtempSync(join(tmpdir(), 'runcastle-no-plugin-'))
    let thrown: unknown
    try {
      resolvePluginDir(empty)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    const msg = (thrown as Error).message
    expect(msg).toMatch(/plugin dir/i)
    // Names at least the starting search location — never a silent bad path.
    expect(msg).toContain(join(empty, 'packages', 'skills', 'packs', 'runcastle'))
  })
})
