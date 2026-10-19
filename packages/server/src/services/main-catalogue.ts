import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  catalogueDependsOn,
  isNodeModule,
  MainCatalogueAttempt,
  MainCatalogueRecord,
  normaliseStoryPath,
  sharedStoryFiles,
  StoriesManifest,
  touchesCatalogue,
  type Feature,
  type MapHistoryEntry,
  type PreviewStats,
  type Project,
  type StoryIndex,
} from '@runcastle/core'
import {
  MAIN_CATALOGUE_ATTEMPT,
  MAIN_CATALOGUE_RECORD,
  STORIES_MANIFEST,
  featureStoriesDir,
  mainStoriesAttemptDir,
  mainStoriesDir,
} from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { AppCtx } from '../db/types'
import { errorText, headline } from '../workflows/review-gates'
import {
  STORIES_BASE_LOG,
  STORIES_BUILD_LOG,
  type StoriesBuildDeps,
  buildCatalogueAt,
  readBuildOutput,
  readStoriesConfigAt,
  swapInto,
} from '../workflows/stories-build'
import { emitProject } from './events'
import { detectMainBranch } from './git'
import { MAP_HISTORY_FORMAT, parseMapHistoryLine } from './map'
import { requireProjectById } from './repo'

/**
 * Main's catalogue (the-map-of-stories-and-scenarios decision 5): one built
 * story catalogue per project, for its main branch, in {@link mainStoriesDir}
 * with {@link MAIN_CATALOGUE_RECORD} beside it. It is filled two ways: a
 * feature's review build promoted at merge when nothing it depends on changed,
 * or a build of main in the gate sandbox — after such a merge, or on an
 * explicit Build the catalogue / Rebuild. Opening the map never builds. The
 * latest attempt (in flight or failed) lives in {@link mainStoriesAttemptDir};
 * a failure never touches the last good catalogue. Every lifecycle step emits
 * a project event (`map.catalogue.*`), which is what refreshes the map.
 */

/** Story history kept per story file, newest first. */
const STORY_HISTORY_CAP = 50

/**
 * The throwaway branch a main build's sandbox checks out: one per commit, so
 * an older build still out is never re-pinned under its sandbox.
 */
export function mainBuildBranch(commit: string): string {
  return `runcastle/stories-main/${commit.slice(0, 12)}`
}

export interface MainBuildOptions {
  /** The commit to build; main's tip when absent. */
  commit?: string
  deps?: StoriesBuildDeps
}

export type MainBuildOutcome =
  | { status: 'built' | 'superseded'; commit: string }
  | { status: 'failed' | 'couldnt_run'; commit: string; reason: string }

/**
 * The sandbox boundary every main build started here uses when the caller
 * passes none; tests stand a fake sandbox in, as for the review build.
 */
let defaultDeps: StoriesBuildDeps | undefined

/** Test seam: the deps a background build ({@link startMainBuild}) runs with. */
export function __setMainBuildDeps(deps?: StoriesBuildDeps): void {
  defaultDeps = deps
}

/** The one build in flight per project: builds of a project never overlap. */
const inFlight = new Map<string, { commit: Promise<string>; done: Promise<void> }>()

/** The running build's end, for callers (tests, scenarios) that must wait it out. */
export function mainBuildSettled(projectId: string): Promise<void> {
  return inFlight.get(projectId)?.done ?? Promise.resolve()
}

/**
 * Start a build of main in the background (Build the catalogue / Rebuild, and
 * a merge that changed what the catalogue depends on). A request while one is
 * running is answered with the running one (`started: false`). The `started`
 * event is emitted before this returns.
 */
export async function startMainBuild(
  ctx: AppCtx,
  projectId: string,
  opts: MainBuildOptions = {},
): Promise<{ started: boolean; commit: string }> {
  const running = inFlight.get(projectId)
  if (running) return { started: false, commit: await running.commit }
  const repo = requireProjectById(ctx, projectId).repoPath
  const commit = opts.commit ? Promise.resolve(opts.commit) : mainTip(repo)
  let begun!: () => void
  const begin = new Promise<void>((resolve) => (begun = resolve))
  const done = commit
    .then((sha) => {
      // A fresh attempt: whatever an earlier one left is not served or read.
      removeQuietly(mainStoriesAttemptDir(projectId))
      return buildMainCatalogue(ctx, projectId, { ...opts, commit: sha, onBegin: begun })
    })
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      begun()
      inFlight.delete(projectId)
    })
  inFlight.set(projectId, { commit, done })
  const sha = await commit
  await begin
  return { started: true, commit: sha }
}

/**
 * Build main's catalogue at a commit and keep it, awaited: on success the
 * output replaces {@link mainStoriesDir} with a `main.json` (source `built`)
 * carrying what it depends on and its story history; on failure the attempt
 * records why, beside its log, and the last good catalogue stays. A result
 * that lands after a newer commit's catalogue or attempt is discarded.
 */
export async function buildMainCatalogue(
  ctx: AppCtx,
  projectId: string,
  opts: MainBuildOptions & { onBegin?: () => void } = {},
): Promise<MainBuildOutcome> {
  const project = requireProjectById(ctx, projectId)
  const repo = project.repoPath
  const commit = opts.commit ?? (await mainTip(repo))
  const deps = opts.deps ?? defaultDeps
  const now = deps?.now ?? Date.now
  const attemptDir = mainStoriesAttemptDir(projectId)
  const outDir = join(attemptDir, `out-${randomUUID().slice(0, 8)}`)
  const startedAt = now()
  mkdirSync(outDir, { recursive: true })
  writeAttempt(projectId, { commit, startedAt, status: 'building' })
  emitProject(ctx, projectId, {
    type: 'map.catalogue.started',
    message: `Building main's catalogue at ${commit.slice(0, 7)}`,
    data: { commit },
  })
  opts.onBegin?.()

  try {
    const build = await buildCatalogueAt({
      config: ctx.config,
      project,
      sha: commit,
      branch: mainBuildBranch(commit),
      outDir,
      deps,
    })
    if (await superseded(repo, projectId, commit)) {
      removeQuietly(outDir)
      if (readAttempt(projectId)?.commit === commit) clearAttemptRecord(projectId)
      return { status: 'superseded', commit }
    }
    if (build.status === 'built') {
      const record: MainCatalogueRecord = {
        projectId,
        commit,
        builtAt: now(),
        source: 'built',
        dependsOn: catalogueDependsOn(build.index, build.stats),
        storyHistory: await computeStoryHistory(repo, commit, build.index, build.stats),
      }
      writeJson(join(outDir, MAIN_CATALOGUE_RECORD), record)
      swapInto(outDir, mainStoriesDir(projectId))
      clearAttemptRecord(projectId)
      emitProject(ctx, projectId, {
        type: 'map.catalogue.built',
        message: `Main's catalogue built at ${commit.slice(0, 7)}`,
        data: { commit },
      })
      return { status: 'built', commit }
    }
    const failure =
      build.status === 'none'
        ? { status: 'couldnt_run' as const, reason: `${commit.slice(0, 7)} has no readable .runcastle/stories.json`, log: '' }
        : build.status === 'failed'
          ? { status: 'failed' as const, reason: `the build exited ${build.exitCode}`, log: build.log }
          : build
    return recordFailure(ctx, projectId, { commit, startedAt, finishedAt: now(), ...failure }, outDir)
  } catch (err) {
    const reason = `the build's output could not be kept: ${headline(errorText(err))}`
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    return recordFailure(
      ctx,
      projectId,
      { commit, startedAt, finishedAt: now(), status: 'couldnt_run', reason, log: detail },
      outDir,
    )
  }
}

function recordFailure(
  ctx: AppCtx,
  projectId: string,
  f: { commit: string; startedAt: number; finishedAt: number; status: 'failed' | 'couldnt_run'; reason: string; log: string },
  outDir: string,
): MainBuildOutcome {
  removeQuietly(outDir)
  try {
    mkdirSync(mainStoriesAttemptDir(projectId), { recursive: true })
    writeFileSync(join(mainStoriesAttemptDir(projectId), STORIES_BUILD_LOG), f.log)
    writeAttempt(projectId, {
      commit: f.commit,
      startedAt: f.startedAt,
      finishedAt: f.finishedAt,
      status: f.status,
      reason: f.reason,
      log: STORIES_BUILD_LOG,
    })
  } catch {
    // the event still says why
  }
  emitProject(ctx, projectId, {
    type: 'map.catalogue.failed',
    message: `Main's catalogue couldn't be built: ${f.reason}`,
    data: { commit: f.commit, status: f.status, reason: f.reason },
  })
  return { status: f.status, commit: f.commit, reason: f.reason }
}

/**
 * Whether a newer commit's catalogue or attempt has landed since this build
 * of `commit` began: then its result is old news.
 */
async function superseded(repo: string, projectId: string, commit: string): Promise<boolean> {
  const newer = [readRecord(projectId)?.commit, readAttempt(projectId)?.commit].filter(
    (c): c is string => c !== undefined && c !== commit,
  )
  for (const other of newer) {
    if (await isAncestor(repo, commit, other)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Promotion at merge
// ---------------------------------------------------------------------------

/**
 * The merge flow's step (decision 5), run after a feature lands on `target`
 * at `mergeCommit` and before its review build is deleted. Into the project's
 * main only: when the feature's last good review build depends on nothing that
 * differs up to the merge commit, it becomes main's catalogue; otherwise main
 * is built in the background. Best-effort — a ship never fails here; a fault
 * is reported as `map.catalogue.failed`.
 */
export async function promoteOrBuildMain(
  ctx: AppCtx,
  project: Project,
  feature: Pick<Feature, 'id'>,
  target: string,
  mergeCommit: string | null,
): Promise<void> {
  try {
    const repo = project.repoPath
    if (target !== (await detectMainBranch(repo))) return
    const merged = mergeCommit ?? (await mainTip(repo))
    // A project without stories has no catalogue to keep current.
    if (!(await readStoriesConfigAt(repo, merged))) return
    const review = readReviewBuild(feature.id)
    if (review) {
      const changed = await changedBetween(repo, review.manifest.commit, merged)
      const dependsOn = catalogueDependsOn(review.index, review.stats)
      if (changed && !touchesCatalogue(changed, dependsOn)) {
        await promote(ctx, project, feature.id, merged, review, dependsOn)
        return
      }
    }
    await startMainBuild(ctx, project.id)
  } catch (err) {
    emitProject(ctx, project.id, {
      type: 'map.catalogue.failed',
      message: `Main's catalogue wasn't kept current: ${headline(errorText(err))}`,
      data: { reason: headline(errorText(err)) },
    })
  }
}

interface ReviewBuild {
  manifest: StoriesManifest
  index: StoryIndex
  stats: PreviewStats
}

/** The feature's review build when it built and its index and import graph are readable. */
function readReviewBuild(featureId: string): ReviewBuild | null {
  const dir = featureStoriesDir(featureId)
  const manifest = StoriesManifest.safeParse(readJson(join(dir, STORIES_MANIFEST)))
  if (!manifest.success || manifest.data.status !== 'built') return null
  const output = readBuildOutput(dir)
  return 'problem' in output ? null : { manifest: manifest.data, ...output }
}

async function promote(
  ctx: AppCtx,
  project: Project,
  featureId: string,
  mergeCommit: string,
  review: ReviewBuild,
  dependsOn: string[],
): Promise<void> {
  const dir = featureStoriesDir(featureId)
  const record: MainCatalogueRecord = {
    projectId: project.id,
    commit: mergeCommit,
    builtAt: Date.now(),
    source: 'promoted',
    featureId,
    dependsOn,
    storyHistory: await computeStoryHistory(
      project.repoPath,
      await mainTip(project.repoPath),
      review.index,
      review.stats,
    ),
  }
  // The feature's own records are not main's: the map reads main.json alone.
  for (const name of [STORIES_MANIFEST, STORIES_BUILD_LOG, STORIES_BASE_LOG]) {
    rmSync(join(dir, name), { force: true })
  }
  writeJson(join(dir, MAIN_CATALOGUE_RECORD), record)
  swapInto(dir, mainStoriesDir(project.id))
  // An older attempt's failure says nothing about the catalogue that just landed.
  if (!inFlight.has(project.id)) removeQuietly(mainStoriesAttemptDir(project.id))
  emitProject(ctx, project.id, {
    type: 'map.catalogue.promoted',
    message: `Main's catalogue is the feature's review build, at ${mergeCommit.slice(0, 7)}`,
    data: { commit: mergeCommit, featureId },
  })
}

// ---------------------------------------------------------------------------
// Story history (decision 6)
// ---------------------------------------------------------------------------

/** Separates commits in the one `git log` pass; never in a sha, time or path. */
const COMMIT_SENTINEL = '\x1e'

/**
 * Each story file's changes on main's first-parent line up to `tip`, newest
 * first and capped: a commit counts when its diff against its first parent
 * touches the story file or anything it imports (per the build's import
 * graph) — except shared files, which most stories reach or many modules
 * import, so a change to a primitive, the theme or a barrel would credit
 * every feature to every component.
 * Staleness and promotion still use the full graph. Uncredited — the map names features by title at read time. One
 * `git log` pass for every story; empty when git cannot answer.
 */
export async function computeStoryHistory(
  repoPath: string,
  tip: string,
  index: StoryIndex,
  stats: PreviewStats,
): Promise<Record<string, MapHistoryEntry[]>> {
  const storyFiles = new Set(
    Object.values(index.entries)
      .filter((e) => e.type === 'story')
      .map((e) => normaliseStoryPath(e.importPath)),
  )
  const graph = importGraph(stats)
  const shared = sharedStoryFiles(
    reachingStories(storyFiles, graph.imports, new Set()),
    storyFiles.size,
    graph.importers,
  )
  const storiesReaching = reachingStories(storyFiles, graph.imports, shared)

  const history: Record<string, MapHistoryEntry[]> = {}
  for (const story of storyFiles) history[story] = []
  let out: string
  try {
    out = await simpleGit(repoPath).raw([
      '-c', 'core.quotePath=false',
      'log', '--first-parent', '-m', '--name-only',
      `--format=${COMMIT_SENTINEL}${MAP_HISTORY_FORMAT}`, tip,
    ])
  } catch {
    return history
  }
  for (const chunk of out.split(COMMIT_SENTINEL)) {
    const [head, ...files] = chunk.split(/\r?\n/)
    const entry = head ? parseMapHistoryLine(head) : null
    if (!entry) continue
    const touched = new Set<string>()
    for (const file of files) {
      for (const story of storiesReaching.get(file) ?? []) touched.add(story)
    }
    for (const story of touched) {
      const list = history[story]
      if (list && list.length < STORY_HISTORY_CAP) list.push(entry)
    }
  }
  return history
}

/** The build's repo-file import graph, both ways: what each file imports, and what imports it. */
function importGraph(stats: PreviewStats): {
  imports: Map<string, Set<string>>
  importers: Map<string, Set<string>>
} {
  const imports = new Map<string, Set<string>>()
  const importers = new Map<string, Set<string>>()
  for (const mod of stats.modules) {
    const imported = normaliseStoryPath(mod.name)
    if (isNodeModule(imported)) continue
    for (const reason of mod.reasons ?? []) {
      const importer = normaliseStoryPath(reason.moduleName)
      if (isNodeModule(importer) || importer === imported) continue
      let set = imports.get(importer)
      if (!set) imports.set(importer, (set = new Set()))
      set.add(imported)
      let by = importers.get(imported)
      if (!by) importers.set(imported, (by = new Set()))
      by.add(importer)
    }
  }
  return { imports, importers }
}

/**
 * Repo file → the story files whose import set holds it (a story file reaches
 * itself). The walk never passes through a `shared` file, so what a barrel
 * re-exports stays out with it.
 */
function reachingStories(
  storyFiles: Set<string>,
  imports: Map<string, Set<string>>,
  shared: Set<string>,
): Map<string, Set<string>> {
  const reaching = new Map<string, Set<string>>()
  for (const story of storyFiles) {
    const seen = new Set([story])
    const queue = [story]
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      for (const next of imports.get(file) ?? []) {
        if (seen.has(next) || shared.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    for (const file of seen) {
      let set = reaching.get(file)
      if (!set) reaching.set(file, (set = new Set()))
      set.add(story)
    }
  }
  return reaching
}

// ---------------------------------------------------------------------------
// Git and disk
// ---------------------------------------------------------------------------

async function mainTip(repoPath: string): Promise<string> {
  const main = await detectMainBranch(repoPath)
  return (await simpleGit(repoPath).revparse([`${main}^{commit}`])).trim()
}

/** Files that differ between two commits, or null when either is gone. */
async function changedBetween(repoPath: string, from: string, to: string): Promise<string[] | null> {
  try {
    const out = await simpleGit(repoPath).raw(['-c', 'core.quotePath=false', 'diff', '--name-only', from, to])
    return out.split(/\r?\n/).filter((l) => l !== '')
  } catch {
    return null
  }
}

async function isAncestor(repoPath: string, ancestor: string, of: string): Promise<boolean> {
  // Not `merge-base --is-ancestor`: its "no" is a bare exit 1, which
  // simple-git does not raise.
  try {
    const g = simpleGit(repoPath)
    const [base, self] = await Promise.all([
      g.raw(['merge-base', ancestor, of]),
      g.revparse([`${ancestor}^{commit}`]),
    ])
    return base.trim() === self.trim()
  } catch {
    return false
  }
}

function readRecord(projectId: string): MainCatalogueRecord | null {
  const parsed = MainCatalogueRecord.safeParse(readJson(join(mainStoriesDir(projectId), MAIN_CATALOGUE_RECORD)))
  return parsed.success ? parsed.data : null
}

function readAttempt(projectId: string): MainCatalogueAttempt | null {
  const parsed = MainCatalogueAttempt.safeParse(
    readJson(join(mainStoriesAttemptDir(projectId), MAIN_CATALOGUE_ATTEMPT)),
  )
  return parsed.success ? parsed.data : null
}

/**
 * Retire the attempt record and its log once a catalogue lands. Any other
 * attempt's out dir stays for its own build; a fresh start clears leftovers.
 */
function clearAttemptRecord(projectId: string): void {
  const dir = mainStoriesAttemptDir(projectId)
  for (const name of [MAIN_CATALOGUE_ATTEMPT, STORIES_BUILD_LOG]) {
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      // best-effort, as removeQuietly
    }
  }
}

function writeAttempt(projectId: string, attempt: MainCatalogueAttempt): void {
  const dir = mainStoriesAttemptDir(projectId)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, MAIN_CATALOGUE_ATTEMPT), attempt)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Best-effort, as the stories store's removals: a dir Windows holds (EBUSY) stays. */
function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // never served or read once its attempt record is gone
  }
}
