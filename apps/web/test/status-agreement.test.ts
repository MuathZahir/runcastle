import { describe, expect, it } from 'vitest'
import type { Need } from '@runcastle/core'
import { featureStateWords } from '../src/components/SidebarParts'
import { triageOf } from '../src/lib/feature-ui/sidebar'
import { featureStatus } from '../src/lib/feature-ui/status-line'
import { listItem, need } from './fixtures'

/**
 * The sidebar row and the feature header follow one rule
 * (needs-you-is-the-agent-s-call decisions 15, 18): the server's `need` and
 * `working`, read the same way in both.
 */
function read(n: Need | null, working: boolean, workersWorking = 0) {
  const row = listItem({ need: n, working, workersWorking })
  const status = featureStatus({
    feature: { status: 'active' },
    need: n,
    working,
    agentWorking: false,
    workersWorking,
    driving: false,
    selfPlanning: false,
    declared: false,
  })
  return {
    lane: triageOf(row),
    words: featureStateWords(row),
    header: status.why ? `${status.label} · ${status.why}` : status.label,
  }
}

describe('the sidebar and the header agree', () => {
  it('a working feature reads Working in both', () => {
    expect(read(null, true, 1)).toEqual({ lane: 'working', words: 'Working', header: 'Working' })
  })

  it('an idle feature reads Idle in both', () => {
    expect(read(null, false)).toEqual({ lane: 'idle', words: 'Idle', header: 'Idle' })
  })

  it('a need beats work in both, in the agent’s own words', () => {
    expect(read(need('Which model?', { threadId: 'wk_1' }), true, 2)).toEqual({
      lane: 'needsYou',
      words: 'Needs you · Which model?',
      header: 'Needs you · Which model?',
    })
  })
})
