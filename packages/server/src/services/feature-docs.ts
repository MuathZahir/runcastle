import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { featureDocsRel, worktreeDir } from '@runcastle/core/paths'

/**
 * Single source of truth for *where* a feature's knowledge docs live on disk,
 * shared by `gates` (checking decisions.md / spec.md) and `knowledge`
 * (scaffold / list / read). The docs live on the feature branch, and the talk
 * worktree is the checkout git keeps of it: creation cuts that worktree to
 * scaffold `brief.md` into it, and every session writes there after, so prefer
 * that path when it exists on disk. The fallback to the project's main checkout
 * covers what has no worktree — a feature whose worktree could not be cut, or a
 * build without B2's worktree service (SPEC §3, task items 7 & 8).
 */

/** Absolute path to the directory holding this feature's docs. */
export function featureDocsDir(project: Project, feature: Feature): string {
  const relSegments = featureDocsRel(feature.slug).split('/') // 'docs/features/<slug>'
  const worktree = worktreeDir(project.id, feature.slug)
  const base = existsSync(worktree) ? worktree : project.repoPath
  return join(base, ...relSegments)
}

/** Absolute path to a named doc file within the feature's docs dir. */
export function featureDocPath(project: Project, feature: Feature, fileName: string): string {
  return join(featureDocsDir(project, feature), fileName)
}
