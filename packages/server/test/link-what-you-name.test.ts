import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'
import { LINK_WHAT_YOU_NAME } from '../src/workers/link-rule'
import { hostGatesReviewBriefing, hostReviewBriefing } from '../src/workers/review'
import { type HostWorkerPlace, hostWorkerBriefing } from '../src/workers/worker'

/**
 * Every agent that talks to the human carries one statement of the linking rule,
 * word for word (chats-link-to-what-they-name decision 6). The skill pack has no
 * include mechanism, so this test keeps the copies from drifting.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

const PARAGRAPH = /^\*\*Link what you name\.\*\*[^\n]*$/gm

const PLACES: Array<[string, string[]]> = [
  ["the orchestrator's skill", ['project', 'SKILL.md']],
  ["the feature lead's skill", ['feature', 'SKILL.md']],
  ['the Q&A skill', ['qa', 'SKILL.md']],
]

const place: HostWorkerPlace = {
  placement: 'feature-folder',
  folder: '/repo',
  featureBranch: 'feature/x',
  branch: null,
  port: 41001,
  previewUrl: 'http://localhost:41001/',
}
const brief = (kind: 'on-its-own' | 'with-you' | 'unassigned') => ({ label: 'Header', kind, goal: 'g', doneWhen: 'd' })

describe('the linking rule', () => {
  it.each(PLACES)('%s carries it once, word for word', (_name, parts) => {
    expect(read(...parts).match(PARAGRAPH) ?? []).toEqual([LINK_WHAT_YOU_NAME])
  })

  it("every worker's briefing carries it", () => {
    for (const kind of ['on-its-own', 'with-you', 'unassigned'] as const) {
      expect(hostWorkerBriefing(brief(kind), place)).toContain(`- ${LINK_WHAT_YOU_NAME}\n`)
    }
    expect(hostGatesReviewBriefing({ label: 'Review', featureBranch: 'feature/x' }, '/repo')).toContain(`- ${LINK_WHAT_YOU_NAME}\n`)
    expect(hostReviewBriefing({ label: 'Review', featureBranch: 'feature/x' }, '/repo')).toContain(`- ${LINK_WHAT_YOU_NAME}\n`)
  })

  it('names the target forms the chat renders', () => {
    for (const form of ['](feature:', 'feature:<slug>/design', '](worker:']) {
      expect(LINK_WHAT_YOU_NAME).toContain(form)
    }
    // The Plan tab is gone (building-starts-without-a-plan-approval decision 3).
    expect(LINK_WHAT_YOU_NAME).not.toContain('/plan')
  })
})
