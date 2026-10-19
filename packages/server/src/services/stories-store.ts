import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { StoriesManifest } from '@runcastle/core'
import { STORIES_MANIFEST, featureStoriesDir, storiesRoot } from '@runcastle/core/paths'

/**
 * The data-dir lifecycle of built story catalogues (decision 5): one build per
 * feature, gone at merge or delete, and base builds kept by commit until no
 * feature's manifest points at them. Best-effort throughout — these run after
 * a merge has landed or a delete is committed to, so a dir that will not go
 * (Windows EBUSY) is left behind rather than failing the flow. No events of
 * their own: the flows that call them already emit.
 */

/** Delete a feature's built catalogue and its manifest. */
export function removeFeatureStories(featureId: string): void {
  try {
    rmSync(featureStoriesDir(featureId), { recursive: true, force: true })
  } catch {
    // best-effort — a stray build is harmless and swept by nothing worse
  }
}

/** Delete every base build no remaining feature's manifest references. */
export function sweepBaseStories(): void {
  const baseRoot = join(storiesRoot(), 'base')
  const commits = listDirs(baseRoot)
  if (commits.length === 0) return
  const referenced = new Set<string>()
  const featuresRoot = join(storiesRoot(), 'features')
  for (const featureId of listDirs(featuresRoot)) {
    const baseCommit = readManifestBaseCommit(join(featuresRoot, featureId, STORIES_MANIFEST))
    if (baseCommit) referenced.add(baseCommit)
  }
  for (const commit of commits) {
    if (referenced.has(commit)) continue
    try {
      rmSync(join(baseRoot, commit), { recursive: true, force: true })
    } catch {
      // best-effort — retried by the next sweep
    }
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

function readManifestBaseCommit(path: string): string | null {
  try {
    const parsed = StoriesManifest.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data.baseCommit : null
  } catch {
    return null
  }
}
