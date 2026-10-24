import { describe, expect, it } from 'vitest'
import {
  backlogDependencies,
  findDependencyCycle,
  isDependencySatisfied,
  stuckReason,
  unstartedState,
  type DependencyRef,
} from '../src/dependencies'

const edge = (dependentId: string, dependencyId: string) => ({ dependentId, dependencyId })

const dep = (over: Partial<DependencyRef> = {}): DependencyRef => ({
  featureId: 'f1',
  slug: 'x',
  title: 'X',
  status: 'active',
  satisfied: false,
  upNext: false,
  ...over,
})
const shipped = dep({ status: 'shipped', satisfied: true })

describe('unstartedState', () => {
  const draft = { status: 'draft', upNext: false } as const
  const marked = { status: 'draft', upNext: true } as const

  it('is null for a started feature', () => {
    expect(unstartedState({ status: 'active', upNext: true }, [dep()])).toBeNull()
  })
  it('marked with an open dependency is upNext', () => {
    expect(unstartedState(marked, [dep(), shipped])).toBe('upNext')
  })
  it('marked with an archived open dependency is stuck', () => {
    expect(unstartedState(marked, [dep(), dep({ status: 'archived' })])).toBe('stuck')
  })
  it('marked with nothing open is stuck', () => {
    expect(unstartedState(marked, [shipped])).toBe('stuck')
    expect(unstartedState(marked, [])).toBe('stuck')
  })
  it('unmarked with an open dependency is blocked', () => {
    expect(unstartedState(draft, [dep()])).toBe('blocked')
  })
  it('unmarked with every dependency shipped is readyToStart', () => {
    expect(unstartedState(draft, [shipped])).toBe('readyToStart')
  })
  it('unmarked with no dependencies is backlog', () => {
    expect(unstartedState(draft, [])).toBe('backlog')
  })
})

describe('stuckReason', () => {
  it('names an archived open dependency', () => {
    expect(stuckReason([dep({ slug: 'old', status: 'archived' })])).toBe(
      'old was archived — remove it or move this to the backlog',
    )
  })
  it('says nothing is left to wait on otherwise', () => {
    expect(stuckReason([shipped])).toBe('nothing left to wait on — start it or move it to the backlog')
  })
})

describe('backlogDependencies', () => {
  it('keeps only unshipped drafts without the mark', () => {
    const parked = dep({ slug: 'p', status: 'draft' })
    const list = [
      parked,
      dep({ slug: 'marked', status: 'draft', upNext: true }),
      dep({ slug: 'live' }),
      dep({ slug: 'done', status: 'draft', satisfied: true }),
    ]
    expect(backlogDependencies(list)).toEqual([parked])
  })
})

describe('isDependencySatisfied', () => {
  it('is satisfied once the dependency has shipped', () => {
    expect(isDependencySatisfied({ status: 'shipped' })).toBe(true)
  })

  it('is unsatisfied in every other status', () => {
    for (const status of ['draft', 'active', 'archived'] as const) {
      expect(isDependencySatisfied({ status })).toBe(false)
    }
  })
})

describe('findDependencyCycle', () => {
  it('returns null for a DAG', () => {
    const edges = [edge('b', 'a'), edge('c', 'b')]
    expect(findDependencyCycle(edges, 'd', ['a', 'c'])).toBeNull()
  })

  it('detects a self-dependency', () => {
    expect(findDependencyCycle([], 'a', ['a'])).toEqual(['a', 'a'])
  })

  it('detects a direct cycle', () => {
    expect(findDependencyCycle([edge('b', 'a')], 'a', ['b'])).toEqual(['a', 'b', 'a'])
  })

  it('detects a transitive cycle', () => {
    const edges = [edge('b', 'c'), edge('c', 'a')]
    expect(findDependencyCycle(edges, 'a', ['b'])).toEqual(['a', 'b', 'c', 'a'])
  })

  it("replaces the dependent's existing edges rather than adding to them", () => {
    // a waits on b, b on c: c waiting on a closes a loop, but a's old edge to
    // b does not survive replacing a's own set.
    const edges = [edge('a', 'b'), edge('b', 'c')]
    expect(findDependencyCycle(edges, 'c', ['a'])).toEqual(['c', 'a', 'b', 'c'])
    expect(findDependencyCycle([...edges, edge('c', 'a')], 'a', ['c'])).toEqual(['a', 'c', 'a'])
    expect(findDependencyCycle([...edges, edge('c', 'a')], 'a', [])).toBeNull()
  })

  it('ignores diamonds that are not cycles', () => {
    const edges = [edge('b', 'd'), edge('c', 'd')]
    expect(findDependencyCycle(edges, 'a', ['b', 'c'])).toBeNull()
  })
})
