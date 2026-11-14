import { describe, expect, it } from 'vitest'
import { NEVER_GUESS, type WorkerBrief, type WorkerSandbox, workerBriefing } from '../src/workers/worker'

/**
 * A worker's briefing carries the rule "never guess what, where or who" and how
 * it applies to that kind of worker (agents-never-guess decision 12). The
 * skills state the rule in their own words; their text is not pinned here
 * (skills-become-short-rules decision 10).
 */
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
