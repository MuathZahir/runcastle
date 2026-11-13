import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The orchestrator's skill is a short list of rules plus format pages
 * (skills-become-short-rules decisions 6, 10). Its wording is not pinned:
 * a size budget per file keeps it short, so growing it means sharpening a
 * rule, not adding one. What stays checked is its frontmatter, the pages it
 * points at, and the names that must never come back.
 */
const skillsDir = (): string => join(resolvePluginDir(), 'skills')
const projectDir = (): string => join(skillsDir(), 'project')
const read = (...parts: string[]): string => readFileSync(join(skillsDir(), ...parts), 'utf8')
const bytes = (path: string): number => statSync(path).size
const referenceFiles = (): string[] => readdirSync(join(projectDir(), 'references')).filter((f) => f.endsWith('.md'))
const allTexts = (): Array<[string, string]> => [
  ['SKILL.md', read('project', 'SKILL.md')],
  ...referenceFiles().map((f): [string, string] => [f, read('project', 'references', f)]),
]

describe('the project skill', () => {
  it('has the frontmatter of the kind=project entry skill', () => {
    const text = read('project', 'SKILL.md')
    expect(text.startsWith('---\nname: project\n')).toBe(true)
    expect(text).toMatch(/^description: .+$/m)
    expect(text).toContain('disable-model-invocation: false')
  })

  it('fits its size budget: SKILL.md at most 7,000 bytes', () => {
    expect(bytes(join(projectDir(), 'SKILL.md'))).toBeLessThanOrEqual(7_000)
  })

  it('keeps every reference page under 6,000 bytes', () => {
    const files = referenceFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(bytes(join(projectDir(), 'references', f)), f).toBeLessThanOrEqual(6_000)
  })

  it('points only at reference pages that exist', () => {
    const text = read('project', 'SKILL.md')
    const pointers = [...text.matchAll(/\.\/references\/([a-z-]+\.md)/g)].map((m) => m[1] as string)
    expect(pointers.length).toBeGreaterThan(0)
    for (const file of pointers) expect(existsSync(join(projectDir(), 'references', file)), file).toBe(true)
  })

  it('names no round, ticket, busy feature or owner, and no tool that is gone', () => {
    for (const [f, text] of allTexts()) {
      expect(text, f).not.toMatch(/\brounds?\b|\btickets?\b|list_tickets|get_ticket|\bbusy\b|\bowners?\b|\bowning\b/i)
      expect(text, f).not.toMatch(/take_over_feature|take_feature|record_test_note|complete_phase|go_feature/)
    }
  })

  it('has no working agreements, checkpoints, check-ins or quick changes', () => {
    for (const [f, text] of allTexts()) {
      expect(text, f).not.toMatch(/working agreement|checkpoint|check-in|quick[ -]change/i)
      expect(text, f).not.toMatch(/\b(phases?|laps?|burn\w*)\b/i)
    }
  })
})

// one-place-to-answer 11: the old relay's names are gone from the whole pack.
describe('the skill pack', () => {
  it('names no relaysHuman, planAgreed or "Yours to plan" anywhere', () => {
    const root = skillsDir()
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8')
      expect(text, f).not.toMatch(/relaysHuman|planAgreed|Yours to plan/)
    }
  })
})

describe('the deleted skills', () => {
  const DELETED = '(ideate|lead|spec|tickets|revisit|design)'

  it('leave the pack with feature, qa, project and code-review', () => {
    expect(readdirSync(skillsDir()).sort()).toEqual(['code-review', 'feature', 'project', 'qa'])
  })

  it('are named by no remaining skill text', () => {
    const reference = new RegExp(
      `runcastle:${DELETED}\\b|\\$${DELETED}\\b|\\b${DELETED}/(SKILL\\.md|references)|\\.\\./${DELETED}/`,
    )
    const files = readdirSync(skillsDir(), { recursive: true, encoding: 'utf8' }).filter((f) => /\.(md|html)$/.test(f))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      expect(readFileSync(join(skillsDir(), file), 'utf8'), file).not.toMatch(reference)
    }
  })
})
