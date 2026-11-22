import { describe, expect, it } from 'vitest'
import { hostGatesReviewBriefing } from '../src/workers/review'
import { NEVER_GUESS, type HostWorkerPlace, hostWorkerBriefing } from '../src/workers/worker'

/**
 * A worker's briefing carries the rule "never guess what, where or who" and how
 * it applies to that kind of worker (agents-never-guess decision 12). The
 * skills state the rule in their own words; their text is not pinned here
 * (skills-become-short-rules decision 10).
 */
const place: HostWorkerPlace = {
  placement: 'feature-folder',
  folder: '/repo',
  featureBranch: 'feature/x',
  branch: null,
  port: 41001,
  previewUrl: 'http://localhost:41001/',
}
const brief = (kind: 'on-its-own' | 'with-you' | 'unassigned') => ({ label: 'Rename', kind, goal: 'g', doneWhen: 'd' })

describe('the never-guess statement', () => {
  it("a worker's briefing carries it under its own heading", () => {
    for (const kind of ['on-its-own', 'with-you', 'unassigned'] as const) {
      expect(hostWorkerBriefing(brief(kind), place)).toContain(`## Ask before you guess\n${NEVER_GUESS}\n`)
    }
  })

  it('an assigned worker asks its lead; an unassigned one asks the human', () => {
    expect(hostWorkerBriefing(brief('on-its-own'), place)).toMatch(/hand back to your lead with the question instead of guessing/)
    expect(hostWorkerBriefing(brief('unassigned'), place)).toMatch(/ask them in this chat before you build anything/)
    expect(hostWorkerBriefing(brief('unassigned'), place)).not.toMatch(/hand back to your lead with the question/)
  })

  it("a review worker's briefing is left alone", () => {
    expect(hostGatesReviewBriefing({ label: 'Review', featureBranch: 'feature/x' }, '/repo')).not.toContain('Never guess what, where or who')
  })
})
