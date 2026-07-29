import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/launcher'
import { KICKOFF_LINES } from '../src/launcher/sessions'

describe('resolvePluginDir', () => {
  it('resolves the real runcastle plugin dir from the module location', () => {
    const dir = resolvePluginDir()
    expect(existsSync(dir)).toBe(true)
    expect(dir.endsWith(join('packages', 'skills', 'packs', 'runcastle'))).toBe(true)
  })

  it('ships a skill for every kickoff line that names one (a /runcastle:x with no SKILL.md is a dead session)', () => {
    const skills = join(resolvePluginDir(), 'skills')
    for (const line of Object.values(KICKOFF_LINES)) {
      const named = line.match(/\/runcastle:([a-z-]+)/)
      if (!named) continue // `prepare` carries its whole brief in the prompt
      const path = join(skills, named[1], 'SKILL.md')
      expect(existsSync(path), named[1]).toBe(true)
      // Skills resolve by folder name; the frontmatter must agree with it.
      expect(readFileSync(path, 'utf8'), named[1]).toContain(`name: ${named[1]}`)
    }
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
