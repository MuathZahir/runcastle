// Merge-order dependencies between features (ADR-0013) — IO-free rules shared by
// the server's dependencies service and the web. A dependent (a draft) waits on
// its dependencies until each one's phase is `shipped`; nothing about that is
// stored, it is derived here at read time.

import type { FeatureStatus, Phase } from './schemas'

/** One dependency as surfaced to the UI and agents, with its derived state. */
export type DependencyRef = {
  featureId: string
  slug: string
  title: string
  phase: Phase
  status: FeatureStatus
  satisfied: boolean
}

/** One dependent a feature is still holding up (it is still a draft). */
export type BlockRef = { featureId: string; slug: string; title: string }

export type DependencyEdge = { dependentId: string; dependencyId: string }

/**
 * A dependency is satisfied once it has merged — `phase === 'shipped'`. Phase,
 * not status: a shipped-then-archived feature (status `archived`) still counts.
 */
export function isDependencySatisfied(f: { phase: Phase }): boolean {
  return f.phase === 'shipped'
}

/**
 * Would replacing `dependentId`'s outgoing edges with `proposed` close a cycle?
 * Returns the cycle as a list of feature ids starting and ending at the same id
 * (a self-dependency is `[a, a]`), or null when the graph stays acyclic.
 */
export function findDependencyCycle(
  edges: DependencyEdge[],
  dependentId: string,
  proposed: string[],
): string[] | null {
  const out = new Map<string, string[]>()
  for (const e of edges) {
    if (e.dependentId === dependentId) continue
    const list = out.get(e.dependentId) ?? []
    list.push(e.dependencyId)
    out.set(e.dependentId, list)
  }
  out.set(dependentId, [...proposed])

  // Any new cycle must pass through dependentId, since only its edges changed.
  const path: string[] = [dependentId]
  const done = new Set<string>()
  const visit = (node: string): string[] | null => {
    for (const next of out.get(node) ?? []) {
      if (next === dependentId) return [...path, next]
      if (done.has(next) || path.includes(next)) continue
      path.push(next)
      const found = visit(next)
      if (found) return found
      path.pop()
      done.add(next)
    }
    return null
  }
  return visit(dependentId)
}
