import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entrySkillDenyRules } from '../src/launcher/artifacts'
import { ENTRY_SKILLS, entrySkillsFor } from '../src/launcher/runtimes/skills'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The feature lead's guidance is skill text (tickets-and-review-are-tools-not-phases
 * decision 4: judgement in the skill, not machinery), so it is pinned the way the
 * other skills are: read the shipped files and assert their wording. It folds in
 * the former ideate, lead, spec, tickets, revisit and design skills, with their
 * detail kept as reference files.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', 'feature', ...parts), 'utf8')

const skill = (): string => read('SKILL.md')
const allTexts = (): [string, string][] => [
  ['SKILL.md', skill()],
  ...readdirSync(join(resolvePluginDir(), 'skills', 'feature', 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f): [string, string] => [f, read('references', f)]),
]

describe('the feature skill', () => {
  it('ships as the entry skill the feature chat alone may open', () => {
    expect(skill()).toMatch(/^---\nname: feature\n/)
    expect(skill()).toContain('disable-model-invocation: false')
    expect(ENTRY_SKILLS).toEqual(['feature', 'qa', 'project', 'prepare'])
    expect(entrySkillsFor('chat')).toEqual(['feature'])
    expect(entrySkillsFor('side')).toEqual([])
    expect(entrySkillDenyRules('chat')).not.toContain('Skill(runcastle:feature)')
    for (const kind of ['project', 'prepare', 'drive-fix', 'side'] as const) {
      expect(entrySkillDenyRules(kind)).toContain('Skill(runcastle:feature)')
    }
  })

  it('makes the chat the lead from its first message, with nothing to unlock', () => {
    expect(skill()).toContain("You are this feature's lead from your first message until the human merges it.")
    expect(skill()).toContain('nothing has to be unlocked')
  })

  it("asks for the human's explicit yes before the first round, and again for an unsettled one", () => {
    const text = skill()
    expect(text).toContain("get the human's **explicit yes in chat**")
    expect(text).toContain('Ask again before any round the agreed plan did not settle.')
  })

  it('leaves review to its judgement, and always runs the checks before ready', () => {
    const text = skill()
    expect(text).toContain('## Review is your call')
    expect(text).toContain('No rule requires one.')
    expect(text).toContain("always run the project's own checks (its typecheck and its tests)")
    expect(text).toContain('`declare_ready({ scenario })`')
    expect(text).toContain('**how you checked it**')
  })

  it('stops itself when a round makes no progress, and leaves Merge and drafts alone', () => {
    const text = skill()
    expect(text).toContain('**Runaway guard.**')
    expect(text).toContain('`wait_for_you({ why: "stuck: <a few words>" })`')
    expect(text).toContain("Merge is the human's, and so is starting a backlog feature.")
    expect(text).toContain('**Never reword a `ticket(<seq>): …` or `runcastle: …` commit**')
  })

  it('links every reference file it carries', () => {
    for (const ref of ['grilling', 'spec', 'tickets', 'rounds', 'planning-alone', 'preview', 'design']) {
      expect(skill()).toContain(`./references/${ref}.md`)
    }
    expect(skill()).toContain('./references/preview-starter.html')
  })

  it('names no Go, lap, phase, complete_phase or mandatory review ticket anywhere', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/\bGo\b|\blaps?\b|(?<!capture-)\bphases?\b|complete_phase|go_feature/)
      expect(text, file).not.toMatch(/every batch closes with/i)
    }
  })

  it('stays project-agnostic: no runcastle-repo paths', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/packages\/|apps\/web|STYLE\.md|DESIGN\.md/)
    }
  })
})

describe('the feature skill, running rounds', () => {
  const text = (): string => read('references', 'rounds.md')

  it('plans a round: named deliverables and checks, a soft cap, contract first', () => {
    expect(text()).toContain('`dispatch_round({ seqs })`')
    expect(text()).toContain('**Every worker task names its deliverable and how it is checked.**')
    expect(text()).toContain('`burnConcurrency` workers or fewer')
    expect(text()).toContain('**Contract first when the work spans layers.**')
    expect(text()).toContain('**Contracts live in code, never in a doc**')
  })

  it('trusts the record when a round returns, and never dispatches under a drive', () => {
    expect(text()).toContain('**Trust the record over the prose.**')
    expect(text()).toContain('A contract reported wrong is a reason to re-plan')
    expect(text()).toContain('Never dispatch while the feature is being driven')
    expect(text()).toContain('**UI work names the design references.**')
  })
})

describe('the feature skill, writing tickets', () => {
  const text = (): string => read('references', 'tickets.md')

  it('budgets the batch parallelism and reslices below the bar', () => {
    expect(text()).toContain('<parallelism-budget>')
    expect(text()).toContain('critical path')
    expect(text()).toContain('T / C')
    expect(text()).toContain('**When it does not clear the bar, reslice.**')
  })

  it('has a review ticket, when there is one, say what to walk', () => {
    expect(text()).toContain('**Say what to walk, never which mode.**')
  })

  it('ships a scenario for hard-to-reach state only in a set-up project', () => {
    expect(text()).toContain('**Ship a scenario when the state is hard to reach.**')
    expect(text()).toContain('**When `setUp` is false**, card nothing about scenarios.')
  })
})

describe('the feature skill, planning with no human present', () => {
  const text = (): string => read('references', 'planning-alone.md')

  it('plans and does not build', () => {
    expect(text()).toContain('**This run plans; it does not build.**')
    expect(text()).toContain('never call `dispatch_round` in this run')
  })

  it('works in one turn, with one challenger and at most five to check first', () => {
    expect(text()).toContain('**One turn.**')
    expect(text()).toContain('**Exactly one challenger.**')
    expect(text()).toContain('Pick at most five decisions')
    expect(text()).toContain('**A refused tool is not a wait.**')
  })

  it("ends by asking for the human's yes with wait_for_you", () => {
    const close = text().slice(text().indexOf('## Straight through, then ask'))
    expect(close).toContain("asking\n   the human for their yes to start round 1")
    expect(close).toContain('`mcp__runcastle__wait_for_you({ why: "start round 1?" })`')
  })
})

describe('the feature skill, grilling', () => {
  const text = (): string => read('references', 'grilling.md')

  it('documents the assumed and challenged lines with an example', () => {
    expect(text()).toContain('**Assumed.** Alternative: <the main alternative>.')
    expect(text()).toContain("**Challenged:** <the challenger's reason>.")
    expect(text()).toContain('**Assumed.** Alternative: a small footer with tags and the last-edited date.')
  })

  it("clears the marks only from decisions the human touched", () => {
    expect(text()).toContain('Decisions they did not touch keep theirs.')
  })
})
