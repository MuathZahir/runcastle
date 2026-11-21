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

  // one-file-per-feature decisions 1, 2, 4, 9 and 10: the lead's rules for the
  // one growing file, one review sized to the change, and how agents talk.
  it('keeps one growing brief.md, with decisions and build notes under it', () => {
    expect(skill()).toMatch(/One file per feature: `brief\.md` grows/)
    expect(skill()).toMatch(/`## Decisions`/)
    expect(skill()).toMatch(/`## Build notes`/)
    const page = read('references', 'feature-file.md')
    expect(page).toMatch(/`## Review summary` \(runcastle adds it at merge; never write it\)/)
    expect(page).toMatch(/already has `decisions\.md` or `spec\.md` keeps writing those/)
  })

  it('quotes the human’s words in assignments and brings the base in before the review and before ready', () => {
    expect(skill()).toMatch(/the human's words it needs unchanged/)
    expect(skill()).toMatch(/bring the base branch in, commit, and get the checks green\*\*, then run one review/)
    expect(skill()).toMatch(/Bring the base in again, then `declare_ready/)
    expect(skill()).toMatch(/skim of the diff's shape/)
  })

  it('picks drive or gates by what users meet, and a second review only after a large fix set', () => {
    expect(skill()).toMatch(/start_review\(\{ mode, checksPassed \}\)/)
    const page = read('references', 'feature-file.md')
    expect(page).toMatch(/`drive` when the change reaches something a user of the project meets/)
    expect(page).toMatch(/`gates` \(reads the diff\) for everything else/)
    expect(page).toMatch(/second review \(`verify`\) only after a large fix set/)
    for (const [file, text] of allTexts()) expect(text, file).not.toMatch(/have a second review verify your fixes/)
  })

  it('writes a scenario for each "No scenario reaches" before ready, not before a verify review', () => {
    expect(skill()).toMatch(/scenario for each "No scenario reaches <state>"/)
    expect(read('references', 'feature-file.md')).toMatch(/\*\*After the review\*\*, write and prove a scenario[^]*before you say ready/)
    for (const [file, text] of allTexts()) expect(text, file).not.toMatch(/Before that verify review/)
  })
})
