import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entrySkillDenyRules } from '../src/launcher/artifacts'
import { ENTRY_SKILLS, entrySkillsFor } from '../src/launcher/runtimes/skills'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The lead's rules are skill text (`the-feature-lead-runs-rounds` decision 6:
 * judgement in the skill, not refusals in the machine), so they are pinned the
 * way the other skills are: read the shipped files and assert their wording.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

describe('the lead skill', () => {
  const skill = (): string => read('lead', 'SKILL.md')

  it('ships as an entry skill the feature chat alone may open', () => {
    const text = skill()
    expect(text).toMatch(/^---\nname: lead\n/)
    expect(text).toContain(
      'description: The runcastle feature lead: after Go, run rounds of workers until the feature is ready for the human to drive.',
    )
    expect(ENTRY_SKILLS).toContain('lead')
    expect(entrySkillsFor('chat')).toContain('lead')
    expect(entrySkillDenyRules('chat')).not.toContain('Skill(runcastle:lead)')
    for (const kind of ['project', 'prepare', 'drive-fix'] as const) {
      expect(entrySkillDenyRules(kind)).toContain('Skill(runcastle:lead)')
    }
  })

  it('delegates by default, and lets the lead change small things itself, verified', () => {
    const text = skill()
    expect(text).toContain('Delegate by default; do it yourself when it is small')
    expect(text).toContain('install dependencies')
    expect(text).toContain("**Verify it with the project's own checks**")
    expect(text).toContain('**Never reword a `ticket(<seq>): …` or `runcastle: …` commit**')
  })

  it('plans a round: named deliverables and checks, titles, a soft cap, contract first', () => {
    const text = skill()
    expect(text).toContain('`dispatch_round({ seqs })`')
    expect(text).toContain('**Every worker task names its deliverable and how it is checked.**')
    expect(text).toContain('**Title tickets `{group}: {task}`**')
    expect(text).toContain('`burnConcurrency` workers or fewer')
    expect(text).toContain('**Contract first when the work spans layers.**')
    expect(text).toContain('`blockedBy` it in the same round')
    expect(text).toContain('**Contracts live in code, never in a doc**')
    expect(text).toContain('those count as satisfied, so keep those edges rather than re-emitting tickets')
    expect(text).toContain('A blocker that is still pending or failed must be named in the same round.')
  })

  it('trusts the record when a round returns, and re-plans on a wrong contract', () => {
    const text = skill()
    expect(text).toContain('**Trust the record over the prose.**')
    expect(text).toContain('`get_ticket({ seq })`')
    expect(text).toContain('A contract reported wrong is a reason to re-plan')
  })

  it('judges when to ask, waits after Stop, and stops itself when a round makes no progress', () => {
    const text = skill()
    expect(text).not.toMatch(/Ask mode|autonomy/)
    expect(text).toContain('**Carry on through anything the plan already settled.**')
    expect(text).toContain('**Stop and ask before anything the plan did not settle**')
    expect(text).toContain('a design decision, a scope change, a trade-off the human would have an opinion on')
    expect(text).toContain('**After the human presses Stop, wait for their reply.**')
    expect(text).toContain('no progress on the same failure as the round before it, **stop**')
    expect(text).toContain('- **Stuck**')
    expect(text).toContain('- **Tried**')
    expect(text).toContain('- **Needed**')
    expect(text).toContain('`wait_for_you({ why: "stuck: <a few words>" })`')
  })

  it('reviews before it declares ready, aims the drive, and relays the warnings', () => {
    const text = skill()
    expect(text).toContain('`kind: "review"`')
    expect(text).toContain('`declare_ready({ scenario, whatToTest })`')
    expect(text).toContain('**what changed, where to look, and what would count as broken.**')
    expect(text).toContain('**Relay every warning it returns**')
  })

  it('never dispatches under a drive, answers the notes, and leaves Merge and drafts alone', () => {
    const text = skill()
    expect(text).toContain('Never dispatch while the feature is being driven')
    expect(text).toContain('Reply first with what you will do about each note')
    expect(text).toContain('**Merge is the human\'s.** So is starting a draft.')
    expect(text).toContain('**Workers are not yours to talk to.**')
  })

  it('asks UI workers to follow the design references and self-critique with screenshots', () => {
    const text = skill()
    expect(text).toContain('**UI work names the design references.**')
    expect(text).toContain('critique it against those docs with screenshots')
  })

  it('stays project-agnostic: no runcastle-repo paths', () => {
    expect(skill()).not.toMatch(/packages\/|apps\/web|STYLE\.md|DESIGN\.md/)
  })
})

describe('laps are gone from the planning skills', () => {
  it('drops the revisit skill’s Lap mode', () => {
    const text = read('revisit', 'SKILL.md')
    expect(text).not.toContain('Lap mode')
    expect(text).not.toContain('PLAN LAP')
    expect(text).not.toMatch(/Start lap|Iterate/)
  })

  it('hands ideate and tickets off with Go, not Burn', () => {
    for (const name of ['ideate', 'tickets']) {
      const text = read(name, 'SKILL.md')
      expect(text, name).not.toMatch(/\bBurn\b/)
    }
    expect(read('ideate', 'SKILL.md')).toContain('Review the ticket cards and click **Go**')
  })
})
