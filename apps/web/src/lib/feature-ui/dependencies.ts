import { backlogDependencies, isDependencySatisfied, type DependencyRef } from '@runcastle/core'
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

/**
 * A draft that cannot be started yet: at least one dependency is unmerged.
 * @deprecated "waiting" now means Up next — classify a draft with core's `unstartedState`.
 */
export function isWaiting(f: Pick<FeatureListItem, 'status' | 'dependsOn'>): boolean {
  return f.status === 'draft' && blockers(f.dependsOn).length > 0
}

/**
 * The one word a dependency's chip states: merged once it shipped (the chip
 * draws the ✓), else its status — `archived`, `draft`, or `in progress` while it
 * is being worked on and has not merged.
 */
export function dependencyState(d: DependencyRef): string {
  if (d.satisfied) return 'merged'
  if (d.status === 'archived') return 'archived'
  if (d.status === 'draft') return 'draft'
  return 'in progress'
}

/** "a (in progress), b (archived)" — each blocker with its state, for a tooltip. */
export function blockerList(deps: DependencyRef[]): string {
  return blockers(deps)
    .map((d) => `${d.slug} (${dependencyState(d)})`)
    .join(', ')
}

/**
 * An Up next feature's hover: it starts by itself when what it still waits on
 * ships — and, while one of those is itself in the backlog, that nothing will
 * move it until the human starts that one (decision 14).
 */
export function upNextHint(deps: DependencyRef[]): string {
  const open = blockers(deps).map((d) => d.slug)
  const when =
    open.length === 1
      ? `starts by itself when ${open[0]} ships`
      : `starts by itself when these ship: ${open.join(', ')}`
  const parked = backlogDependencies(deps).map((d) => d.slug)
  return parked.length > 0 ? `${when} — won't start until you start ${parked.join(', ')}` : when
}

/**
 * Why Start is disabled on a waiting draft, or null when it waits on nothing.
 * Mirrors the server's `startDraft` refusal (`describeBlocker`), minus its
 * Markdown backticks — this is a plain-text caption. An archived blocker
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
