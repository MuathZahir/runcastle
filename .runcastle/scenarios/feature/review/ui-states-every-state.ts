/**
 * Scenario: the UI-states section's other states, side by side in one project.
 *
 * Run like feature-with-ui-states (`bun {file}` inside a test drive of
 * runcastle). That one shows a real build, where every story is new because
 * main has no stories yet. This one seeds two more features at review on the
 * drive's branch, so the drive can see what a real build cannot show yet:
 *
 * - **compare** — this checkout's catalogue, built once on the host, copied in
 *   as the feature's build AND as a base build at a fixed fake commit, with a
 *   manifest that marks two stories changed (before/after pairs), one new and
 *   the rest also affected (the collapsed line). Printed as `ENTRY_URL`.
 * - **failed** — a manifest saying the build failed, beside a Vite error in
 *   `build.log`. Printed as `FAILED_URL`.
 *
 * Only the drive's data dir is written. No branch, worktree or other ref is
 * made in the repo.
 */
import { randomBytes } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ClassifiedStory,
  type StoriesManifest,
  type StoryIndexEntry,
  StoriesManifest as StoriesManifestSchema,
  StoryIndex,
} from '../../../../packages/core/src/stories.ts'
import { STORIES_MANIFEST, baseStoriesDir, featureStoriesDir } from '../../../../packages/core/src/paths.ts'
import { STORIES_BUILD_LOG } from '../../../../packages/server/src/workflows/stories-build.ts'
import {
  type SeededFeature,
  buildCatalogueOnHost,
  checkoutProject,
  checkoutRoot,
  featureUrl,
  headCommit,
  seedFeatureAtReview,
  withDriveDb,
} from '../../_fixtures/ui-states.ts'

/** The compare feature's branch point: never a real commit, so no real feature shares its base dir. */
const FAKE_BASE_COMMIT = 'ba5eba5eba5eba5eba5eba5eba5eba5eba5eba5e'

/** How many stories the compare feature shows as before/after pairs. */
const CHANGED_COUNT = 2

const FAILED_LOG = `vite v8.1.4 building for production...
transforming...
✓ 412 modules transformed.
x Build failed in 2.31s
error during build:
[vite:esbuild] Transform failed with 1 error:
apps/web/src/components/review/UiStatesSection.tsx:48:14: ERROR: Expected ")" but found "frame"
file: apps/web/src/components/review/UiStatesSection.tsx:48:14

  46 |        <ul className="grid gap-3">
  47 |          {stories.map((story) => (
  48 |            <li key={story.id} frame={story.frameUrl}
     |                               ^
  49 |          ))}
  50 |        </ul>

    at failureErrorWithLog (node_modules/esbuild/lib/main.js:1472:15)
    at node_modules/esbuild/lib/main.js:755:50
SB_BUILDER-VITE_0001 (ViteBuildError): Storybook failed to build the preview.
`

function writeManifest(dir: string, manifest: StoriesManifest): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, STORIES_MANIFEST), `${JSON.stringify(StoriesManifestSchema.parse(manifest), null, 2)}\n`)
}

function head(seeded: SeededFeature, commit: string): Pick<
  StoriesManifest,
  'featureId' | 'commit' | 'lap' | 'reviewTicketId' | 'builtAt'
> {
  return {
    featureId: seeded.feature.id,
    commit,
    lap: seeded.reviewTicket.lap,
    reviewTicketId: seeded.reviewTicket.id,
    builtAt: Date.now(),
  }
}

/** Real story ids from the build, split into changed, one new, and the rest affected. */
function classify(entries: StoryIndexEntry[]): ClassifiedStory[] {
  if (entries.length < CHANGED_COUNT + 2) {
    throw new Error(`the build lists ${entries.length} stories; the compare feature needs ${CHANGED_COUNT + 2}`)
  }
  return entries.map((entry, i) => {
    const kind = i < CHANGED_COUNT ? 'changed' : i === CHANGED_COUNT ? 'new' : 'affected'
    return {
      id: entry.id,
      title: entry.title,
      name: entry.name,
      importPath: entry.importPath,
      kind,
      distance: kind === 'affected' ? 2 : i === 0 ? 0 : 1,
    }
  })
}

/** The compare feature: one real build as both "before" and "after". */
function seedCompare(seeded: SeededFeature, build: string, commit: string): void {
  const index = StoryIndex.parse(JSON.parse(readFileSync(join(build, 'index.json'), 'utf8')))
  const stories = classify(
    Object.values(index.entries)
      .filter((e) => e.type === 'story')
      .sort((a, b) => a.id.localeCompare(b.id)),
  )

  const base = baseStoriesDir(FAKE_BASE_COMMIT)
  rmSync(base, { recursive: true, force: true })
  cpSync(build, base, { recursive: true })
  // The new story did not exist at the branch point.
  const newId = stories.find((s) => s.kind === 'new')!.id
  const { [newId]: _added, ...baseEntries } = index.entries
  writeFileSync(join(base, 'index.json'), JSON.stringify({ ...index, entries: baseEntries }))

  const dir = featureStoriesDir(seeded.feature.id)
  rmSync(dir, { recursive: true, force: true })
  cpSync(build, dir, { recursive: true })
  writeFileSync(join(dir, STORIES_BUILD_LOG), 'built by the UI states every-state scenario\n')
  writeManifest(dir, {
    ...head(seeded, commit),
    baseCommit: FAKE_BASE_COMMIT,
    base: 'built',
    status: 'built',
    log: STORIES_BUILD_LOG,
    stories,
  })
}

/** The failed feature: a manifest and its log, no catalogue (decision 5). */
function seedFailed(seeded: SeededFeature, commit: string): void {
  const dir = featureStoriesDir(seeded.feature.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, STORIES_BUILD_LOG), FAILED_LOG)
  writeManifest(dir, {
    ...head(seeded, commit),
    baseCommit: null,
    base: 'none',
    status: 'failed',
    log: STORIES_BUILD_LOG,
    stories: [],
  })
}

try {
  await withDriveDb(async (ctx) => {
    const repoRoot = checkoutRoot()
    const project = await checkoutProject(ctx, repoRoot)
    const commit = await headCommit(repoRoot)
    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')

    const build = mkdtempSync(join(tmpdir(), 'rc-ui-states-'))
    try {
      await buildCatalogueOnHost(repoRoot, build)
      const compare = await seedFeatureAtReview(ctx, project, `UI states compared ${run}`)
      seedCompare(compare, build, commit)
      const failed = await seedFeatureAtReview(ctx, project, `UI states failed ${run}`)
      seedFailed(failed, commit)

      console.log(`[ui-states-every-state] compare: ${compare.feature.slug}; failed: ${failed.feature.slug}`)
      console.log(`ENTRY_URL=${featureUrl(project, compare.feature)}`)
      console.log(`FAILED_URL=${featureUrl(project, failed.feature)}`)
    } finally {
      rmSync(build, { recursive: true, force: true })
    }
  })
} catch (e) {
  console.error(`[ui-states-every-state] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
