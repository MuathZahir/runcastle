import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoundTrail } from '../src/components/review/RoundTrail'
import type { RoundTrail as RoundTrailFigure, TrailTicket } from '../src/lib/feature-ui/rounds'

/**
 * The round trail as the feature page renders it (decision 16) — tier 1, the
 * whole behaviour is the markup: each round's facts as text, the agent's own
 * fixes, the ready declarations with their what-to-test paragraph folded.
 */
const worker = (seq: number, status: string, over: Partial<TrailTicket> = {}): TrailTicket => ({
  id: `t${seq}`,
  seq,
  title: `pricing: task ${seq}`,
  status,
  ...over,
})

const trail: RoundTrailFigure = {
  entries: [
    {
      type: 'round',
      round: 1,
      runId: 'r1',
      status: 'succeeded',
      workers: [worker(1, 'done'), worker(2, 'done'), worker(3, 'failed')],
      landed: 2,
      failed: 1,
      gates: { ok: true, failed: [] },
      durationMs: 18 * 60_000,
      verdict: 'Pricing landed; the totals worker failed on a fixture.',
    },
    { type: 'agent-fix', commits: [{ sha: 'abc1234def5678', subject: 'feat(pricing): rename the total field' }], files: ['a.ts', 'b.ts'] },
    { type: 'ready', scenario: 'Apply a coupon at checkout', afterRound: 1 },
    {
      type: 'round',
      round: 2,
      runId: 'r2',
      status: 'running',
      workers: [worker(4, 'burning')],
      landed: 0,
      failed: 0,
      gates: null,
      durationMs: null,
      verdict: null,
    },
  ],
  notDispatched: [worker(5, 'pending')],
}

const render = (figure: RoundTrailFigure = trail): string =>
  renderToStaticMarkup(createElement(RoundTrail, { trail: figure }))

describe('RoundTrail', () => {
  it('states each round’s workers, duration, landed/failed and gates as text — never tokens', () => {
    const html = render()
    expect(html).toContain('Round 1')
    expect(html).toContain('3 workers')
    expect(html).not.toContain('tokens')
    expect(html).toContain('18m 00s')
    expect(html).toContain('2 landed')
    expect(html).toContain('1 failed')
    expect(html).toContain('gates passed')
    expect(html).toContain('Pricing landed; the totals worker failed on a fixture.')
  })

  it('lists a round’s workers by their stored titles', () => {
    expect(render()).toContain('#1 · pricing: task 1')
  })

  it('says a running round is running and leaves out what it does not know yet', () => {
    const html = render()
    expect(html).toContain('Round 2')
    expect(html).toContain('1 worker')
    expect(html).toContain('running')
  })

  it('shows the agent’s own fix with its commits', () => {
    const html = render()
    expect(html).toContain('Agent fix')
    expect(html).toContain('1 commit')
    expect(html).toContain('2 files')
    expect(html).toContain('abc1234')
    expect(html).toContain('feat(pricing): rename the total field')
  })

  it('shows a ready declaration’s scenario alone: what to test is said in the chat', () => {
    const html = render()
    expect(html).toContain('Ready for you')
    expect(html).toContain('after round 1')
    expect(html).toContain('Test drive ▸ Apply a coupon at checkout')
    expect(html).not.toContain('What to test')
  })

  it('lists tickets no round has held as not yet dispatched', () => {
    expect(render()).toContain('Not yet dispatched · 1')
  })

  it('names a failing gate', () => {
    const [first] = trail.entries
    const html = render({
      entries: [{ ...first!, gates: { ok: false, failed: ['bun run test'] } } as RoundTrailFigure['entries'][number]],
      notDispatched: [],
    })
    expect(html).toContain('gates failed: bun run test')
  })

  it('renders nothing for a feature with no rounds and nothing pending', () => {
    expect(render({ entries: [], notDispatched: [] })).toBe('')
  })

  it('carries no lap vocabulary', () => {
    expect(render()).not.toMatch(/\blaps?\b/i)
  })
})
