import { describe, expect, it } from 'vitest'
import { cardLines, needWords, portfolioEntries, portfolioTotals } from '../src/lib/portfolio'
import { listItem, need } from './fixtures'

/**
 * The All projects page's one decision, pure: which project gets a card and
 * which a quiet line, what a card lists, and the order (always the given one).
 */

const project = (id: string, name = id) => ({ id, name, repoPath: `/code/${name}`, position: 0 })

const waits = (id: string, words = 'Plan to approve') => listItem({ id, need: need('plan', words) })
const runs = (id: string) => listItem({ id, workersWorking: 1 })
const idle = (id: string) => listItem({ id })

describe('portfolioEntries', () => {
  it('gives a card to a project something waits or runs in, and a line to a quiet one', () => {
    const entries = portfolioEntries(
      [project('a'), project('b'), project('c'), project('d')],
      [[idle('a1')], [waits('b1')], [runs('c1')], []],
    )
    expect(entries.map((e) => [e.project.id, e.kind])).toEqual([
      ['a', 'line'],
      ['b', 'card'],
      ['c', 'card'],
      ['d', 'line'],
    ])
  })

  it('keeps the given order, never putting waiting or running first', () => {
    const entries = portfolioEntries(
      [project('quiet'), project('runs'), project('waits')],
      [[idle('q')], [runs('r')], [waits('w')]],
    )
    expect(entries.map((e) => e.project.id)).toEqual(['quiet', 'runs', 'waits'])
  })

  it('uses the sidebar’s Needs-you rule: a held need, or a parked draft, does not wait', () => {
    const held = listItem({ id: 'h', need: need('plan', 'Plan to approve', { held: true }) })
    const draft = listItem({ id: 'd', status: 'draft', need: need('plan', 'Plan to approve') })
    const [entry] = portfolioEntries([project('a')], [[held, draft]])
    expect(entry!.kind).toBe('line')
    expect(entry!.waiting).toEqual([])
  })

  it('lists what waits with its short words, and what runs', () => {
    const [entry] = portfolioEntries(
      [project('a')],
      [[waits('w1', 'Needs your answer · Which sound plays?'), runs('r1'), idle('i1')]],
    )
    expect(entry!.waiting.map((w) => [w.feature.id, w.words])).toEqual([['w1', 'Needs your answer']])
    expect(entry!.running.map((f) => f.id)).toEqual(['r1'])
    expect(entry!.stats).toMatchObject({ needsYou: 1, working: 1, total: 3 })
  })

  it('reads a project whose list has not answered as a loading quiet line', () => {
    const [entry] = portfolioEntries([project('a')], [undefined])
    expect(entry).toMatchObject({ kind: 'line', loading: true })
  })
})

describe('cardLines', () => {
  it('lists up to three waiting features, then how many more, and no running ones', () => {
    const lines = cardLines({
      waiting: ['1', '2', '3', '4', '5'].map((id) => ({ feature: waits(id), words: 'x' })),
      running: [runs('r')],
    })
    expect(lines.waiting.map((w) => w.feature.id)).toEqual(['1', '2', '3'])
    expect(lines.moreWaiting).toBe(2)
    expect(lines.running).toEqual([])
  })

  it('lists up to three running features where nothing waits', () => {
    const lines = cardLines({ waiting: [], running: ['1', '2', '3', '4'].map(runs) })
    expect(lines.running.map((f) => f.id)).toEqual(['1', '2', '3'])
    expect(lines.moreWaiting).toBe(0)
  })
})

describe('portfolioTotals', () => {
  it('counts projects, running and waiting features across every project', () => {
    const entries = portfolioEntries([project('a'), project('b')], [[waits('w'), runs('r')], [runs('r2')]])
    expect(portfolioTotals(entries)).toEqual({ projects: 2, running: 2, waiting: 1 })
  })
})

describe('needWords', () => {
  it('keeps the reason and drops its detail', () => {
    expect(needWords('Ready to test · Streak resets at midnight')).toBe('Ready to test')
    expect(needWords('Plan to approve')).toBe('Plan to approve')
  })
})
