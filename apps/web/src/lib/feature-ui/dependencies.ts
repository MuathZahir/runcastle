import { isDependencySatisfied, type DependencyRef } from '@runcastle/core'
import type { FeatureListItem } from '../api'

/**
 * Merge-order dependencies (ADR-0013) as the web shows them: the rail chip, the
 * draft's disabled Start, the Waits-on row and its picker. Every input is wire
 * data — `satisfied` is the server's derived flag, never recomputed here.
 */

/** The dependencies a draft is still waiting on, in the server's (slug) order. */
export function blockers(deps: DependencyRef[]): DependencyRef[] {
  return deps.filter((d) => !d.satisfied)
}

/** A draft that cannot be started yet: at least one dependency is unmerged. */
export function isWaiting(f: Pick<FeatureListItem, 'status' | 'dependsOn'>): boolean {
  return f.status === 'draft' && blockers(f.dependsOn).length > 0
}

/**
 * The one word a dependency's chip states: merged once it shipped (the chip
 * draws the ✓), else what it is doing now — `archived` and `draft` over its
 * phase, because an archived or parked feature's phase says nothing about when
 * it will merge.
 */
export function dependencyState(d: DependencyRef): string {
  if (d.satisfied) return 'merged'
  if (d.status === 'archived') return 'archived'
  if (d.status === 'draft') return 'draft'
  return d.phase
}

/** "a (building), b (archived)" — each blocker with its state, for a tooltip. */
export function blockerList(deps: DependencyRef[]): string {
  return blockers(deps)
    .map((d) => `${d.slug} (${dependencyState(d)})`)
    .join(', ')
}

/**
 * Why Start is disabled on a waiting draft, or null when it waits on nothing.
 * The same wording the server's `startDraft` refusal uses: an archived blocker
 * never merges on its own, so it says the one way past it — remove the edge.
 */
export function waitingReason(deps: DependencyRef[]): string | null {
  const open = blockers(deps)
  if (open.length === 0) return null
  const named = open.map((d) =>
    d.status === 'archived' ? `${d.slug} (archived — remove it to start)` : `${d.slug} (${dependencyState(d)})`,
  )
  return `Waits on ${named.join(', ')}`
}

/**
 * What the Waits-on picker offers: the project's other features that have not
 * merged and are not already in the set. A pick that would close a cycle is
 * offered all the same — the server refuses it, and the row shows why.
 */
export function dependencyCandidates(
  features: FeatureListItem[],
  self: { id: string; projectId: string },
  chosen: DependencyRef[],
): FeatureListItem[] {
  const taken = new Set(chosen.map((d) => d.featureId))
  return features.filter(
    (f) =>
      f.projectId === self.projectId &&
      f.id !== self.id &&
      !taken.has(f.id) &&
      !isDependencySatisfied(f),
  )
}
