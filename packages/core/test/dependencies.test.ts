import { describe, expect, it } from 'vitest'
import { findDependencyCycle, isDependencySatisfied } from '../src/dependencies'

const edge = (dependentId: string, dependencyId: string) => ({ dependentId, dependencyId })

describe('isDependencySatisfied', () => {
  it('is satisfied once the dependency has shipped', () => {
    expect(isDependencySatisfied({ phase: 'shipped' })).toBe(true)
  })

  it('counts a shipped-then-archived feature as merged', () => {
    const shippedThenArchived = { phase: 'shipped', status: 'archived' } as const
    expect(isDependencySatisfied(shippedThenArchived)).toBe(true)
  })

  it('is unsatisfied in every other phase', () => {
    for (const phase of ['planning', 'building', 'review'] as const) {
      expect(isDependencySatisfied({ phase })).toBe(false)
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
