// Merge-order dependencies between features (ADR-0013) — IO-free rules shared by
// the server's dependencies service and the web. A dependent (a draft) waits on
// its dependencies until each one has shipped; nothing about that is stored, it
// is derived here at read time.

import type { FeatureStatus } from './schemas'

/** One dependency as surfaced to the UI and agents, with its derived state. */
export type DependencyRef = {
  featureId: string
  slug: string
  title: string
  status: FeatureStatus
  satisfied: boolean
  /** The dependency's own up-next mark. */
  upNext: boolean
}

/** One dependent a feature is still holding up (it is still a draft). */
export type BlockRef = { featureId: string; slug: string; title: string; upNext: boolean }

export type DependencyEdge = { dependentId: string; dependencyId: string }

/** Timeline event types of the up-next mark (`waiting-is-not-backlog`). */
export const UPNEXT_CHANGED = 'feature.upnext.changed'
export const AUTOSTART_SKIPPED = 'feature.autostart.skipped'
export const AUTOSTART_FAILED = 'feature.autostart.failed'
/** On the shipped dependency's timeline: it started a feature that was waiting. */
export const UPNEXT_STARTED = 'feature.upnext.started'

/** Where an unstarted feature sits, derived from its mark and dependencies. */
export type UnstartedState = 'upNext' | 'stuck' | 'blocked' | 'readyToStart' | 'backlog'

/** Classify a feature that has not started; null once it has. */
export function unstartedState(
  f: { status: FeatureStatus; upNext: boolean },
  deps: DependencyRef[],
): UnstartedState | null {
  if (f.status !== 'draft') return null
  const open = deps.filter((d) => !d.satisfied)
  if (f.upNext) {
    return open.length > 0 && open.every((d) => d.status !== 'archived') ? 'upNext' : 'stuck'
  }
  if (open.length > 0) return 'blocked'
  return deps.length > 0 ? 'readyToStart' : 'backlog'
}

/** Why a marked feature is `stuck`, from its dependencies alone (UI text). */
export function stuckReason(deps: DependencyRef[]): string {
  const archived = deps.find((d) => !d.satisfied && d.status === 'archived')
  if (archived) return `${archived.slug} was archived — remove it or move this to the backlog`
  return 'nothing left to wait on — start it or move it to the backlog'
}

/** Unsatisfied dependencies that are in the backlog: nothing will move them by itself. */
export function backlogDependencies(deps: DependencyRef[]): DependencyRef[] {
  return deps.filter((d) => !d.satisfied && d.status === 'draft' && !d.upNext)
}

/**
 * A dependency is satisfied once it has merged — `status === 'shipped'`. There
 * is no phase to remember a merge by, so a dependency shipped and then archived
 * reads as an archived open one: its dependents say so and name the fix.
 */
export function isDependencySatisfied(f: { status: FeatureStatus }): boolean {
  return f.status === 'shipped'
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
