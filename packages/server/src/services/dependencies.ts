import type { BlockRef, DependencyEdge, DependencyRef, Feature } from '@runcastle/core'
import { findDependencyCycle, isDependencySatisfied } from '@runcastle/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { featureDependencies, features } from '../db/schema'
import { InvalidInputError } from '../errors'
import { emit } from './events'
import { getFeatureRow, rowToFeature } from './repo'

/**
 * Merge-order dependencies (ADR-0013) — the single writer and reader of
 * `feature_dependencies`. A draft (the dependent) waits on other features in its
 * project until each one's phase is `shipped`; satisfaction is derived here at
 * read time and never stored. The only thing a dependency gates is the draft's
 * Start (`startDraft`); there is no override — editing the set is the lever.
 */

function toDependencyRef(f: Feature): DependencyRef {
  return {
    featureId: f.id,
    slug: f.slug,
    title: f.title,
    phase: f.phase,
    status: f.status,
    satisfied: isDependencySatisfied(f),
  }
}

function toBlockRef(f: Feature): BlockRef {
  return { featureId: f.id, slug: f.slug, title: f.title }
}

/** Every edge whose dependent lives in `projectId` — one query. */
export function listDependencyEdges(ctx: AppCtx, projectId: string): DependencyEdge[] {
  return ctx.db
    .select({
      dependentId: featureDependencies.dependentId,
      dependencyId: featureDependencies.dependencyId,
    })
    .from(featureDependencies)
    .innerJoin(features, eq(features.id, featureDependencies.dependentId))
    .where(eq(features.projectId, projectId))
    .all()
}

/**
 * Check a proposed dependency set for `dependentId` (null = a draft about to be
 * created, which nothing can depend on yet, so no cycle is possible) and return
 * the resolved, de-duplicated dependency features. Everything `setDependencies`
 * refuses except the draft check, so the create path can validate BEFORE it
 * inserts a row.
 */
export function validateDependencies(
  ctx: AppCtx,
  projectId: string,
  dependentId: string | null,
  dependencyIds: string[],
): Feature[] {
  const ids = [...new Set(dependencyIds)]
  if (dependentId !== null && ids.includes(dependentId)) {
    const self = getFeatureRow(ctx, dependentId)
    throw new InvalidInputError(`\`${self.slug}\` cannot wait on itself`)
  }
  if (ids.length === 0) return []

  const found = ctx.db
    .select()
    .from(features)
    .where(inArray(features.id, ids))
    .all()
    .map(rowToFeature)
  const byId = new Map(found.map((f) => [f.id, f]))
  const unknown = ids.filter((id) => !byId.has(id))
  if (unknown.length) {
    throw new InvalidInputError(`unknown feature(s): ${unknown.join(', ')}`)
  }
  const resolved = ids.map((id) => byId.get(id) as Feature)

  const foreign = resolved.filter((f) => f.projectId !== projectId)
  if (foreign.length) {
    throw new InvalidInputError(
      `${slugList(foreign)} ${foreign.length === 1 ? 'is' : 'are'} in another project — a feature can only wait on features in its own project`,
    )
  }
  const merged = resolved.filter(isDependencySatisfied)
  if (merged.length) {
    throw new InvalidInputError(
      `${slugList(merged)} ${merged.length === 1 ? 'has' : 'have'} already merged — nothing to wait on`,
    )
  }

  if (dependentId !== null) {
    const cycle = findDependencyCycle(listDependencyEdges(ctx, projectId), dependentId, ids)
    if (cycle) {
      const slugs = slugsById(ctx, cycle)
      throw new InvalidInputError(
        `that would form a cycle: ${cycle.map((id) => `\`${slugs.get(id) ?? id}\``).join(' → ')}`,
      )
    }
  }
  return resolved
}

/**
 * Replace a draft's whole dependency set (decision 4) — the one edit path, shared
 * by the UI and agents. Refuses a started dependent: once started its
 * dependencies are history and gate nothing.
 */
export function setDependencies(
  ctx: AppCtx,
  dependentId: string,
  dependencyIds: string[],
): DependencyRef[] {
  const dependent = getFeatureRow(ctx, dependentId)
  if (dependent.status !== 'draft') {
    throw new InvalidInputError(
      `\`${dependent.slug}\` is not a draft — dependencies can only be set on a draft; once started they no longer gate anything`,
    )
  }
  const resolved = validateDependencies(ctx, dependent.projectId, dependentId, dependencyIds)

  const createdAt = Date.now()
  ctx.db.transaction((tx) => {
    tx.delete(featureDependencies).where(eq(featureDependencies.dependentId, dependentId)).run()
    if (resolved.length) {
      tx.insert(featureDependencies)
        .values(resolved.map((f) => ({ dependentId, dependencyId: f.id, createdAt })))
        .run()
    }
  })

  const slugs = resolved.map((f) => f.slug)
  emit(ctx, dependentId, {
    type: 'feature.dependencies.changed',
    message: slugs.length
      ? `${dependent.slug} waits on ${slugs.map((s) => `\`${s}\``).join(', ')}`
      : `${dependent.slug} waits on nothing`,
    data: { dependsOn: slugs },
  })
  return dependsOnOf(ctx, dependentId)
}

/** What `featureId` waits on (or, once started, waited on), with derived state. */
export function dependsOnOf(ctx: AppCtx, featureId: string): DependencyRef[] {
  return ctx.db
    .select({ feature: features })
    .from(featureDependencies)
    .innerJoin(features, eq(features.id, featureDependencies.dependencyId))
    .where(eq(featureDependencies.dependentId, featureId))
    .orderBy(features.slug)
    .all()
    .map(({ feature }) => toDependencyRef(rowToFeature(feature)))
}

/** The unsatisfied subset of {@link dependsOnOf} — non-empty means "waiting". */
export function waitingOn(ctx: AppCtx, featureId: string): DependencyRef[] {
  return dependsOnOf(ctx, featureId).filter((d) => !d.satisfied)
}

/**
 * The dependents `featureId` is still holding up: drafts waiting on it while it
 * is unmerged. A started dependent's edge is history, and a shipped
 * dependency's edges gate nothing, so neither is listed.
 */
export function blocksOf(ctx: AppCtx, featureId: string): BlockRef[] {
  if (isDependencySatisfied(getFeatureRow(ctx, featureId))) return []
  return ctx.db
    .select({ feature: features })
    .from(featureDependencies)
    .innerJoin(features, eq(features.id, featureDependencies.dependentId))
    .where(and(eq(featureDependencies.dependencyId, featureId), eq(features.status, 'draft')))
    .orderBy(features.slug)
    .all()
    .map(({ feature }) => toBlockRef(rowToFeature(feature)))
}

/**
 * `dependsOn` and `blocks` for every feature in a project from ONE edge query,
 * given the project's features already loaded — the rail's list must not query
 * per row. Same semantics as {@link dependsOnOf} / {@link blocksOf}.
 */
export function dependencyMaps(
  ctx: AppCtx,
  projectId: string,
  projectFeatures: Feature[],
): { dependsOn: Map<string, DependencyRef[]>; blocks: Map<string, BlockRef[]> } {
  const byId = new Map(projectFeatures.map((f) => [f.id, f]))
  const dependsOn = new Map<string, DependencyRef[]>()
  const blocks = new Map<string, BlockRef[]>()
  for (const { dependentId, dependencyId } of listDependencyEdges(ctx, projectId)) {
    const dependent = byId.get(dependentId)
    const dependency = byId.get(dependencyId)
    if (!dependent || !dependency) continue
    dependsOn.set(dependentId, [...(dependsOn.get(dependentId) ?? []), toDependencyRef(dependency)])
    if (dependent.status === 'draft' && !isDependencySatisfied(dependency)) {
      blocks.set(dependencyId, [...(blocks.get(dependencyId) ?? []), toBlockRef(dependent)])
    }
  }
  for (const refs of [...dependsOn.values(), ...blocks.values()]) {
    refs.sort((x, y) => x.slug.localeCompare(y.slug))
  }
  return { dependsOn, blocks }
}

/** Every dependent of `featureId`, any status — whose edges a delete removes. */
export function dependentsOf(ctx: AppCtx, featureId: string): Feature[] {
  return ctx.db
    .select({ feature: features })
    .from(featureDependencies)
    .innerJoin(features, eq(features.id, featureDependencies.dependentId))
    .where(eq(featureDependencies.dependencyId, featureId))
    .all()
    .map(({ feature }) => rowToFeature(feature))
}

/**
 * How a blocker reads in a refusal: its phase while live, `draft` while parked,
 * and for an archived one the only way out (there is no override).
 */
export function describeBlocker(d: DependencyRef): string {
  if (d.status === 'archived') return `\`${d.slug}\` (archived — remove it to start)`
  if (d.status === 'draft') return `\`${d.slug}\` (draft)`
  return `\`${d.slug}\` (${d.phase})`
}

function slugList(fs: Feature[]): string {
  return fs.map((f) => `\`${f.slug}\``).join(', ')
}

function slugsById(ctx: AppCtx, ids: string[]): Map<string, string> {
  const rows = ctx.db
    .select({ id: features.id, slug: features.slug })
    .from(features)
    .where(inArray(features.id, [...new Set(ids)]))
    .all()
  return new Map(rows.map((r) => [r.id, r.slug]))
}
