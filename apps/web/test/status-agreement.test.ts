import { describe, expect, it } from 'vitest'
import { featureNeed, type NeedFacts } from '@runcastle/core'
import { featureStateWords } from '../src/components/SidebarParts'
import { triageOf } from '../src/lib/feature-ui/sidebar'
import { featureStatus } from '../src/lib/feature-ui/status-line'
import { listItem } from './fixtures'

/**
 * triage-batch decision 13: the sidebar row and the feature header follow one
 * rule. The same facts go through the server's need (core `featureNeed`), then
 * into both: they must agree on whether the human is needed, and in what words.
 */

const NOW = 10_000_000

function facts(over: Partial<NeedFacts>): NeedFacts {
  return {
    status: 'active',
    owner: null,
    askingChat: null,
    agentWorking: false,
    workersAtWork: false,
    waiting: null,
    leadAwaitsHuman: null,
    openAsk: null,
    conflictSince: null,
    declaration: null,
    latestRoundStartedAt: null,
    humanDriveEndedAt: null,
    humanMessageAt: null,
    driveConfigured: true,
    wakeFailed: null,
    wakeQueuedAt: null,
    designsWaiting: 0,
    oldestDesignWaitingSince: null,
    workerNeedsYou: null,
    handback: null,
    ...over,
  }
}

/** Both readings of one feature: the sidebar's lane and words, the header's status words. */
function read(over: Partial<NeedFacts>, workersWorking: number) {
  const need = featureNeed(facts({ ...over, workersAtWork: workersWorking > 0 }), NOW)
  const row = listItem({ need, workersWorking })
  const status = featureStatus({
    feature: { status: 'active' },
    need,
    workersWorking,
    agentWorking: false,
    driving: false,
    selfPlanning: false,
    now: NOW,
  })
  return {
    lane: triageOf(row),
    words: featureStateWords(row),
    header: status.why ? `${status.label} · ${status.why}` : status.label,
    headerKind: status.kind,
  }
}

const replied = { leadAwaitsHuman: { since: 4_000 } }
const ask = { kind: 'question' as const, title: 'Which database?', threadId: 'chat_1', since: 3_000 }
const worker = { label: 'Honest statuses', threadId: 'wk_1', since: 6_000 }
const wait = { reason: 'which model?', kind: null, since: 5_000 }

describe('the sidebar and the header agree on the same facts', () => {
  it('a lead that replied while a worker works reads as working in both', () => {
    const r = read(replied, 1)
    expect(r.lane).toBe('agentWorking')
    expect(r.words).toBe('Working · 1 worker')
    expect(r.headerKind).toBe('working')
    expect(r.header).toBe('Working · 1 worker at work')
  })

  it('a lead that replied with no worker at work still reads as needing an answer in both', () => {
    const r = read(replied, 0)
    expect(r.lane).toBe('needsYou')
    expect(r.words).toBe('Needs your answer')
    expect(r.header).toBe('Needs your answer')
  })

  const realWaits: Array<[string, Partial<NeedFacts>, string]> = [
    ['the lead’s own wait_for_you', { ...replied, waiting: wait }, 'Needs your answer · which model?'],
    ['an open question box', { ...replied, openAsk: ask }, 'Needs your answer · Which database?'],
    ['a worker that needs the human', { ...replied, workerNeedsYou: worker }, 'Honest statuses needs you'],
    ['a permission prompt', { ...replied, openAsk: { ...ask, kind: 'approval', title: 'Bash: git push' } }, 'Needs permission · Bash: git push'],
  ]
  for (const [name, over, words] of realWaits) {
    it(`${name} beats workers at work, in the same words in both`, () => {
      const r = read(over, 2)
      expect(r.lane).toBe('needsYou')
      expect(r.words).toBe(words)
      expect(r.headerKind).toBe('waiting')
      expect(r.header).toBe(words)
    })
  }
})
