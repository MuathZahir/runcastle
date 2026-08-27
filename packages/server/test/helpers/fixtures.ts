import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import type { AppCtx } from '../../src/db/types'
import { features, projects } from '../../src/db/schema'
import { rowToFeature, rowToProject } from '../../src/services/repo'

/** A fresh writable temp dir to stand in for a target repo checkout. */
export function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'runcastle-test-'))
}

/** Insert a project row directly (bypasses the B2 git validation in services). */
export function seedProject(ctx: AppCtx, repoPath: string = tmpRepo()): Project {
  const inserted = ctx.db
    .insert(projects)
    .values({ id: newId('proj'), name: 'test', repoPath, devCommand: null })
    .returning()
    .get()
  return rowToProject(inserted)
}

/**
 * Insert a feature row directly with sensible defaults. A seeded feature is a
 * cut one, so it records a base (`main`) like every real feature does; pass
 * `baseBranch: null` for the two rows that genuinely have none — a parked draft,
 * or a legacy row from before the column existed.
 */
export function seedFeature(
  ctx: AppCtx,
  projectId: string,
  overrides: Partial<Feature> & { baseBranch?: string | null } = {},
): Feature {
  const slug = overrides.slug ?? 'demo'
  const inserted = ctx.db
    .insert(features)
    .values({
      id: overrides.id ?? newId('feat'),
      projectId,
      slug,
      title: overrides.title ?? 'Demo feature',
      oneLiner: overrides.oneLiner ?? 'a demo feature',
      brief: overrides.brief ?? null,
      mapped: overrides.mapped ?? false,
      lap: overrides.lap ?? 1,
      phase: overrides.phase ?? 'ideation',
      branch: overrides.branch ?? `feature/${slug}`,
      baseBranch: overrides.baseBranch === undefined ? 'main' : overrides.baseBranch,
      status: overrides.status ?? 'active',
      createdAt: overrides.createdAt ?? Date.now(),
    })
    .returning()
    .get()
  return rowToFeature(inserted)
}
