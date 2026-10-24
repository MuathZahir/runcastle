import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The orchestrator's behaviour is skill text, pinned the way `self-plan-skill.test`
 * pins planning without a human: read the shipped files and assert their wording.
 * The orchestrating briefing names the section by its heading, so the heading is
 * load-bearing, and the tool names must match the tools the server registers.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

const ORCHESTRATOR_TOOLS = [
  'get_project_context',
  'create_feature',
  'take_over_feature',
  'start_feature',
  'plan_feature',
  'send_to_feature',
  'stop_feature_run',
  'drive',
  'record_test_note',
  'merge_feature',
  'add_to_brief',
  'get_feature_context',
  'read_feature_doc',
  'list_tickets',
  'get_ticket',
]

describe('the project skill, orchestrating', () => {
  const skill = (): string => read('project', 'SKILL.md')
  const section = (): string => {
    const text = skill()
    const at = text.search(/^## Orchestrating$/m)
    expect(at).toBeGreaterThanOrEqual(0)
    return text.slice(at, text.indexOf('\n## ', at + 1))
  }

  it('is announced near the top as applying only to the orchestrator', () => {
    const text = skill()
    const top = text.slice(0, text.indexOf('## Your tools'))
    expect(top).toContain('**When your briefing says you are the orchestrator**')
    expect(top).toContain('still governs you')
    expect(section()).toContain('applies only when your briefing says you are the orchestrator')
  })

  it('names every orchestrator tool', () => {
    const text = section()
    for (const tool of ORCHESTRATOR_TOOLS) expect(text).toContain(`\`${tool}`)
  })

  it('guards its context with cheaper subagents on both CLIs', () => {
    const text = section()
    expect(text).toContain('the Agent tool with `model: "sonnet"`')
    expect(text).toContain('`spawn_agent` with a smaller model if it accepts one')
    expect(text).toContain("**Do not go into a feature's details unless something needs it**")
    expect(text).toContain("reorient from runcastle's record, not from memory")
  })

  it('asks the human one question at a time, only when a wrong guess would cost a lap', () => {
    const text = section()
    expect(text).toContain('a wrong guess would cost a lap')
    expect(text).toContain('**One question at a time**')
    expect(text).toContain('**Keep everything else moving while you wait**')
    expect(text).toContain("saying it is the human's answer")
  })

  it('agrees how the cut is run before creating anything, and works within it', () => {
    const text = section()
    const agreement = text.indexOf('### The working agreement')
    expect(agreement).toBeGreaterThanOrEqual(0)
    expect(agreement).toBeLessThan(text.indexOf('### Grill, create, and what is yours'))
    expect(text).toContain('**Before you create anything for a cut, ask the human how they want the work run.**')
    expect(text).toContain('One question, with your recommendation')
    expect(text).toContain('**Autonomous**')
    expect(text).toContain('**Checkpoints they name**')
    expect(text).toContain('**A check-in after each feature**')
    expect(text).toContain('**"You decide" means autonomous.**')
    expect(text).toContain('**Always offer all three shapes**, even for a cut of one feature')
    expect(text).toContain('**Every new request is a new cut**')
    expect(text).toContain('unless the human has said the earlier agreement stands for it')
    expect(text).toContain('**Write the agreement into the brief of every feature in the cut**')
    expect(text).toContain('read the agreement back from the briefs')
    expect(text).toContain('**Autonomous: never stop for a test drive.**')
    expect(text).toContain('**never create review tickets yourself**')
    expect(text).toContain('**Checkpoints: stop exactly at the points they named**')
    expect(text).toContain('**Drive when the agreement calls for the human\'s eyes**')
  })

  it('reads runcastle messages and the catch-up, and stops on one move', () => {
    const text = section()
    expect(text).toContain('`[runcastle]`')
    expect(text).toContain('"Since you were last live"')
    expect(text).toContain('**One move stops you.**')
    expect(text).toContain('start nothing new')
  })

  it("acts only on its own features and never in a live session's worktree", () => {
    const text = section()
    expect(text).toContain("**Features you did not create are the human's**")
    expect(text).toContain('never act on them')
    expect(text).toContain("**Never work in a feature's worktree while that feature has a live session.**")
    expect(text).toContain('**`decisions.md` is the record**')
  })
})

describe('the project skill, with no Go and no quick changes', () => {
  const texts = (): string[] =>
    ['SKILL.md', 'references/triage.md', 'references/health-sweeps.md'].map((f) => read('project', ...f.split('/')))

  it('mentions neither Go, go_feature nor a quick change', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/\bGo\b/)
      expect(text).not.toMatch(/go_feature|quick[ -]change/i)
      expect(text).not.toMatch(/create_feature\(\{[^}]*tickets/)
    }
  })

  it("creates a feature with a brief, and has its own agent ask the human for the yes", () => {
    const text = texts()[0]
    expect(text).toContain('`create_feature({ title, oneLiner, brief })`')
    expect(text).toContain('asks the human for the yes in its chat')
  })
})

describe('the feature skill and the orchestrator', () => {
  const text = (): string => read('feature', 'references', 'grilling.md')

  it('marks a change made on the orchestrator\'s message, and clears it for a relayed human answer', () => {
    const at = text().indexOf("**A change on the orchestrator's message is not the human's.**")
    expect(at).toBeGreaterThanOrEqual(0)
    const docs = text().slice(at, text().indexOf('\n\n', at))
    expect(docs).toContain('`**Changed by the orchestrator:** <why>`')
    expect(docs).toContain('keeps its\n`**Assumed.**` line, or gains one')
    expect(docs).toContain("A message that relays the human's own answer is\nthe human confirming")
  })
})

describe('the deleted skills', () => {
  const skillsDir = join(resolvePluginDir(), 'skills')
  const DELETED = '(ideate|lead|spec|tickets|revisit|design)'

  it('leave the pack with feature, qa, project, prepare and code-review', () => {
    expect(readdirSync(skillsDir).sort()).toEqual(['code-review', 'feature', 'prepare', 'project', 'qa'])
  })

  it('are named by no remaining skill text', () => {
    const reference = new RegExp(
      `runcastle:${DELETED}\\b|\\$${DELETED}\\b|\\b${DELETED}/(SKILL\\.md|references)|\\.\\./${DELETED}/`,
    )
    const files = readdirSync(skillsDir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(md|html)$/.test(f))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      expect(readFileSync(join(skillsDir, file), 'utf8'), file).not.toMatch(reference)
    }
  })
})
