import { mkdtempSync, rmSync } from 'node:fs'
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

/**
 * Remove a temp tree, with the retry backstop win32 needs.
 *
 * `rmSync` defaults to `maxRetries: 0`. On POSIX an open handle never blocks an
 * unlink, so that default is fine; on Windows a directory a git child or an
 * `fs.watch` handle touched moments ago fails outright with `EBUSY`/`EPERM`
 * because the handle is released asynchronously. That surfaces as a red test
 * with nothing wrong in it — the assertions passed, the teardown threw.
 *
 * Retrying costs nothing when the first attempt succeeds, which is every
 * removal off win32.
 */
export function rmTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
