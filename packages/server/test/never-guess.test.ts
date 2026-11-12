import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'
import { NEVER_GUESS, type WorkerBrief, type WorkerSandbox, workerBriefing } from '../src/workers/worker'

/**
 * Every agent carries one statement of the rule "never guess what, where or
 * who", word for word (agents-never-guess decision 12). The skill pack has no
 * include mechanism, so this test is what keeps the copies from drifting.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

const PARAGRAPH = /^\*\*Never guess what, where or who\.\*\*[^\n]*$/gm

const PLACES: Array<[string, string[]]> = [
  ["the orchestrator's skill", ['project', 'SKILL.md']],
  ["the feature lead's skill", ['feature', 'SKILL.md']],
  ['the lone-planning reference', ['feature', 'references', 'planning-alone.md']],
]

const sandbox: WorkerSandbox = {
  id: 'w1',
  engine: 'docker',
  runtime: 'claude-code',
  container: 'c1',
  repoPath: '/repo',
  featureBranch: 'feature/x',
  branch: 'runcastle/worker/x',
  port: 41001,
  previewUrl: 'http://localhost:41001/',
}
const brief = (kind: WorkerBrief['kind']): WorkerBrief => ({ label: 'Rename', kind, goal: 'g', doneWhen: 'd' })

describe('the never-guess statement', () => {
  it.each(PLACES)('%s carries it once, word for word', (_name, parts) => {
    const found = read(...parts).match(PARAGRAPH) ?? []
    expect(found).toEqual([NEVER_GUESS])
  })

  it("a worker's briefing carries it under its own heading", () => {
    for (const kind of ['on-its-own', 'with-you', 'unassigned'] as const) {
      expect(workerBriefing(sandbox, brief(kind))).toContain(`## Ask before you guess\n${NEVER_GUESS}\n`)
    }
  })

  it('an assigned worker asks its lead; an unassigned one asks the human', () => {
    expect(workerBriefing(sandbox, brief('on-its-own'))).toMatch(/hand back to your lead with the question instead of guessing/)
    expect(workerBriefing(sandbox, brief('unassigned'))).toMatch(/ask them in this chat before you build anything/)
    expect(workerBriefing(sandbox, brief('unassigned'))).not.toMatch(/hand back to your lead with the question/)
  })

  it("a review worker's briefing is left alone", () => {
    expect(workerBriefing(sandbox, brief('review'))).not.toContain('Never guess what, where or who')
  })
})

describe('how each place applies it', () => {
  it('the orchestrator cuts nothing until the three are settled, and the one-question floor is gone', () => {
    const intake = read('project', 'references', 'intake.md')
    expect(read('project', 'SKILL.md')).toMatch(/cut and create nothing until the three are settled/)
    expect(intake).toMatch(/Ask first about whichever of what, where and who is open/)
    expect(intake).not.toMatch(/at least one (answered )?question/i)
  })

  it('a lone planning run checks the three first and stops on an open one', () => {
    const alone = read('feature', 'references', 'planning-alone.md')
    expect(alone).toContain('**The three come first.**')
    expect(alone).toMatch(/wait_for_you\(\{ why: "what, where or who is open", kind:\s+"answer" \}\)/)
  })

  it('a lead offers a design only once the three are settled', () => {
    const design = read('feature', 'references', 'design.md')
    expect(design).toContain('**Offer it once what, where and who are settled.**')
    expect(design).not.toMatch(/first reply/)
  })
})
