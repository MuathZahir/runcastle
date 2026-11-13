import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entrySkillDenyRules } from '../src/launcher/artifacts'
import { ENTRY_SKILLS, entrySkillsFor } from '../src/launcher/runtimes/skills'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The feature lead's skill is a short list of rules plus format pages
 * (skills-become-short-rules decisions 6 and 10). Its wording is not pinned: a
 * size budget keeps it short, so growing it means sharpening a rule, not adding
 * one. What is checked here is how it ships, and that it stays within budget.
 */
const featureDir = (): string => join(resolvePluginDir(), 'skills', 'feature')
const read = (...parts: string[]): string => readFileSync(join(featureDir(), ...parts), 'utf8')
const bytes = (...parts: string[]): number => statSync(join(featureDir(), ...parts)).size

const skill = (): string => read('SKILL.md')
const referencePages = (): string[] => readdirSync(join(featureDir(), 'references')).filter((f) => f.endsWith('.md'))
const allTexts = (): [string, string][] => [
  ['SKILL.md', skill()],
  ...referencePages().map((f): [string, string] => [f, read('references', f)]),
]

/** The budgets of decision 6: about 5K for the entry skill, every reference page under 6K. */
const BUDGET = 6000

describe('the feature skill', () => {
  it('ships as the entry skill the feature chat alone may open', () => {
    expect(skill()).toMatch(/^---\nname: feature\n/)
    expect(skill()).toContain('disable-model-invocation: false')
    expect(ENTRY_SKILLS).toEqual(['feature', 'qa', 'project'])
    expect(entrySkillsFor('chat')).toEqual(['feature'])
    expect(entrySkillsFor('side')).toEqual([])
    expect(entrySkillDenyRules('chat')).not.toContain('Skill(runcastle:feature)')
    for (const kind of ['project', 'drive-fix', 'side'] as const) {
      expect(entrySkillDenyRules(kind)).toContain('Skill(runcastle:feature)')
    }
  })

  it(`keeps SKILL.md within ${BUDGET} bytes`, () => {
    expect(bytes('SKILL.md')).toBeLessThanOrEqual(BUDGET)
  })

  it.each(referencePages())(`keeps references/%s within ${BUDGET} bytes`, (page) => {
    expect(bytes('references', page)).toBeLessThanOrEqual(BUDGET)
  })

  it('names every reference page it carries, and the Plan starter', () => {
    for (const page of referencePages()) expect(skill()).toContain(`./references/${page}`)
    expect(skill()).toContain('./references/preview-starter.html')
  })

  it('names no Go, lap, phase, complete_phase or mandatory review ticket anywhere', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/\bGo\b|\blaps?\b|(?<!capture-)\bphases?\b|complete_phase|go_feature/)
      expect(text, file).not.toMatch(/every batch closes with/i)
    }
  })

  it('names no rounds, tickets, owners or kinds of wait (skills-become-short-rules decision 1)', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/\brounds?\b|\btickets?\b|get_ticket|\bowners?\b|wait_for_you\(\{[^)]*kind/i)
    }
  })

  it('stays project-agnostic: no runcastle-repo paths', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/packages\/|apps\/web|STYLE\.md|DESIGN\.md/)
    }
  })
})
