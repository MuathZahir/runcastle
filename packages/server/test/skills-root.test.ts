import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'
import { SKILLS_DIR_ENV, resolveSkillsRoot } from '../src/launcher/skills-root'
import { burnerTemplatePath } from '../src/workflows/ticket-burner'
import { researchTemplatePath } from '../src/workflows/research'

/**
 * Issue #51 — a published `runcastle` ships skills as real files, so the runtime
 * must resolve the plugin pack and burner templates from the *installed*
 * location, not only the contributor workspace. `RUNCASTLE_SKILLS_DIR` points at
 * the vendored root (mirroring `RUNCASTLE_WEB_DIST` for the SPA); with it unset,
 * resolution ascends to the workspace `packages/skills` exactly as before.
 */

/** A throwaway dir shaped like a vendored skills root (has packs/runcastle). */
function fakeSkillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runcastle-skills-'))
  mkdirSync(join(root, 'packs', 'runcastle'), { recursive: true })
  mkdirSync(join(root, 'burner'), { recursive: true })
  return root
}

afterEach(() => {
  delete process.env[SKILLS_DIR_ENV]
})

describe('resolveSkillsRoot', () => {
  it('honours RUNCASTLE_SKILLS_DIR when it points at a real skills root', () => {
    const root = fakeSkillsRoot()
    process.env[SKILLS_DIR_ENV] = root
    expect(resolveSkillsRoot('/nowhere/at/all')).toBe(root)
  })

  it('throws when the override is not a skills root', () => {
    const empty = mkdtempSync(join(tmpdir(), 'runcastle-empty-'))
    process.env[SKILLS_DIR_ENV] = empty
    expect(() => resolveSkillsRoot('/nowhere')).toThrow(/RUNCASTLE_SKILLS_DIR/)
  })

  it('falls back to the workspace packages/skills when unset', () => {
    const root = resolveSkillsRoot(import.meta.dirname)
    expect(existsSync(join(root, 'packs', 'runcastle'))).toBe(true)
    expect(root.endsWith(join('packages', 'skills'))).toBe(true)
  })

  it('throws a loud error naming what was searched', () => {
    const empty = mkdtempSync(join(tmpdir(), 'runcastle-none-'))
    expect(() => resolveSkillsRoot(empty)).toThrow(/skills root not found/i)
  })
})

describe('vendored-location resolution', () => {
  it('resolvePluginDir reads the pack from RUNCASTLE_SKILLS_DIR', () => {
    const root = fakeSkillsRoot()
    process.env[SKILLS_DIR_ENV] = root
    expect(resolvePluginDir()).toBe(join(root, 'packs', 'runcastle'))
  })

  it('burner + research templates read from RUNCASTLE_SKILLS_DIR', () => {
    const root = fakeSkillsRoot()
    process.env[SKILLS_DIR_ENV] = root
    expect(burnerTemplatePath()).toBe(join(root, 'burner', 'implement-ticket.md'))
    expect(researchTemplatePath()).toBe(join(root, 'burner', 'research-waypoint.md'))
  })
})
