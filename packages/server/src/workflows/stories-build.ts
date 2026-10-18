import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import simpleGit from 'simple-git'
import {
  type ClassifiedStory,
  type Feature,
  type Project,
  type RuncastleConfig,
  type StoriesBase,
  type StoriesBuildRecord,
  type StoriesConfig,
  type StoriesManifest,
  type Ticket,
  PreviewStats,
  STORIES_CONFIG_REL,
  StoryIndex,
  classifyFeatureStories,
  parseStoriesConfig,
  renderStoriesBuildCommand,
} from '@runcastle/core'
import { STORIES_MANIFEST, baseStoriesDir, featureStoriesDir, storiesRoot } from '@runcastle/core/paths'
import {
  GATE_COMMAND_TIMEOUT_MS,
  type GateExecResult,
  type GateSandbox,
  type GateSandboxStep,
  type WithGateSandbox,
  burnGateSandbox,
  errorText,
  execWithTimeout,
  headline,
  timeoutReason,
  withThrowawayBranch,
} from './review-gates'

/**
 * A review pass's UI-states build (features-show-their-ui-states-as-stories
 * decisions 4-6): the project's own `.runcastle/stories.json` build command run
 * at the feature branch's tip, in the gate sandbox right after the verify
 * commands, its static output copied into {@link featureStoriesDir} with a
 * {@link StoriesManifest} classifying the stories the feature touched. The
 * branch point's catalogue is built once per commit into {@link baseStoriesDir}
 * and shared. Never throws: every environment fault is `couldnt_run`.
 */

/** The build's own output, written next to the catalogue it produced (or alone, when it failed). */
export const STORIES_BUILD_LOG = 'build.log'
/** A failed base build's output, kept in the feature dir — a failure is never cached by commit. */
export const STORIES_BASE_LOG = 'base-build.log'

export interface StoriesBuildDeps {
  /** The sandbox boundary for any build not riding the gate run's sandbox. */
  withSandbox?: WithGateSandbox
  /** The build's time limit; defaults to the gate commands' own. */
  commandTimeoutMs?: number
  now?: () => number
}

export interface StoriesBuildInput {
  config: RuncastleConfig
  project: Project
  feature: Pick<Feature, 'id' | 'baseBranch'>
  ticket: Pick<Ticket, 'id' | 'lap'>
  /** The feature-branch tip the gates run against. */
  sha: string
  /** The feature event emitted once a build's manifest lands. */
  emit?: (e: { type: string; message: string; data?: unknown }) => void
  deps?: StoriesBuildDeps
}

/**
 * A pass's build, split around the sandbox so the feature build can ride the
 * gate run's ({@link GateSandboxStep}): `step` is absent when the branch has no
 * stories; `finish` reads what the step left and returns the record.
 */
export interface StoriesBuildPlan {
  step?: GateSandboxStep
  finish(): Promise<StoriesBuildRecord>
}

/** The throwaway branch a stand-alone feature build checks out. */
export function storiesBuildBranch(ticketId: string): string {
  return `runcastle/stories/${ticketId}`
}

/** The throwaway branch the branch point's build checks out. */
export function storiesBaseBranch(ticketId: string): string {
  return `runcastle/stories-base/${ticketId}`
}

/** What the feature build's command did, as the sandbox step saw it. */
type BuildOutcome =
  | { kind: 'exited'; result: GateExecResult }
  | { kind: 'couldnt_run'; reason: string; detail: string }

/** Build the feature's catalogue (and its branch point's) in a sandbox of its own. */
export async function runStoriesBuild(input: StoriesBuildInput): Promise<StoriesBuildRecord> {
  const plan = await planStoriesBuild(input)
  const { step } = plan
  if (step) {
    const withSandbox = input.deps?.withSandbox ?? burnGateSandbox(input.config, input.project)
    const branch = storiesBuildBranch(input.ticket.id)
    try {
      await withThrowawayBranch(input.project.repoPath, branch, input.sha, () =>
        withSandbox(branch, (sandbox) => step.run(sandbox), { outDir: step.outDir }),
      )
    } catch (err) {
      step.abandon(`the sandbox could not be set up: ${headline(errorText(err))}`, err)
    }
  }
  return plan.finish()
}

/**
 * Decide whether this pass builds, and prepare the step that does. Never
 * throws: a branch whose `stories.json` cannot be read is a branch without
 * stories.
 */
export async function planStoriesBuild(input: StoriesBuildInput): Promise<StoriesBuildPlan> {
  const { feature, sha } = input
  const cfg = await readStoriesConfigAt(input.project.repoPath, sha)
  if (!cfg) {
    // A branch that dropped (or never had) stories shows no section: an old
    // build would be a catalogue of code this branch no longer has.
    return {
      finish: async () => {
        if (existsSync(featureStoriesDir(feature.id))) {
          removeQuietly(featureStoriesDir(feature.id))
          input.emit?.({
            type: 'stories.removed',
            message: 'UI states removed: the branch no longer has stories',
          })
        }
        return { status: 'none' }
      },
    }
  }

  const timeoutMs = input.deps?.commandTimeoutMs ?? GATE_COMMAND_TIMEOUT_MS
  let incoming: string
  try {
    incoming = incomingDir(input.ticket.id)
  } catch (err) {
    const reason = `no place to put the build: ${headline(errorText(err))}`
    return { finish: async () => ({ status: 'couldnt_run', commit: sha, reason, log: null }) }
  }
  let outcome: BuildOutcome | undefined
  const step: GateSandboxStep = {
    outDir: incoming,
    run: async (sandbox: GateSandbox) => {
      const command = renderStoriesBuildCommand(cfg, sandbox.outPath ?? incoming)
      try {
        const result = await execWithTimeout(sandbox, command, timeoutMs)
        outcome = result === 'timeout'
          ? { kind: 'couldnt_run', reason: `the build ${timeoutReason(timeoutMs)}`, detail: timeoutReason(timeoutMs) }
          : { kind: 'exited', result }
      } catch (err) {
        outcome = {
          kind: 'couldnt_run',
          reason: `the build could not start: ${headline(errorText(err))}`,
          detail: errorDetail(err),
        }
      }
    },
    abandon: (reason, err) => {
      outcome ??= { kind: 'couldnt_run', reason, detail: errorDetail(err) }
    },
  }

  return {
    step,
    finish: async () => {
      try {
        return await finishBuild(input, cfg, incoming, outcome)
      } catch (err) {
        const reason = `the build's output could not be kept: ${headline(errorText(err))}`
        try {
          publishResult(input, incoming, couldntRunManifest(input, reason), errorDetail(err))
        } catch {
          // the record still comes back, and says why
        }
        emitBuilt(input, 'stories.couldnt_run', `UI states couldn't be built: ${reason}`)
        return { status: 'couldnt_run', commit: sha, reason, log: null }
      } finally {
        removeQuietly(incoming)
      }
    },
  }
}

async function finishBuild(
  input: StoriesBuildInput,
  cfg: StoriesConfig,
  incoming: string,
  outcome: BuildOutcome | undefined,
): Promise<StoriesBuildRecord> {
  const { sha } = input
  if (!outcome) outcome = { kind: 'couldnt_run', reason: 'the build never ran', detail: 'the build never ran' }
  if (outcome.kind === 'couldnt_run') {
    publishResult(input, incoming, couldntRunManifest(input, outcome.reason), outcome.detail)
    emitBuilt(input, 'stories.couldnt_run', `UI states couldn't be built: ${outcome.reason}`)
    return { status: 'couldnt_run', commit: sha, reason: outcome.reason, log: STORIES_BUILD_LOG }
  }

  const { result } = outcome
  let log = [result.stdout, result.stderr].filter(Boolean).join('\n')
  let output: { index: StoryIndex; stats: PreviewStats } | undefined
  if (result.exitCode === 0) {
    const read = readBuildOutput(incoming)
    if ('problem' in read) log = `${log}\n\nruncastle: ${read.problem}\n`
    else output = read
  }
  if (!output) {
    publishResult(input, incoming, failedManifest(input), log)
    emitBuilt(input, 'stories.failed', "The UI states didn't build")
    return { status: 'failed', commit: sha, exitCode: result.exitCode, log: STORIES_BUILD_LOG }
  }

  const { commit: baseCommit, base, pending, log: baseLog } = await resolveBase(input)
  const stories = classifyFeatureStories({
    changedFiles: await changedFilesSince(input.project.repoPath, baseCommit, sha),
    index: output.index,
    stats: output.stats,
    base,
  })
  writeFileSync(join(incoming, STORIES_BUILD_LOG), log)
  if (baseLog !== undefined) writeFileSync(join(incoming, STORIES_BASE_LOG), baseLog)
  const manifest: StoriesManifest = {
    ...manifestHead(input),
    baseCommit,
    base: base.status,
    status: 'built',
    log: STORIES_BUILD_LOG,
    stories,
  }
  writeFileSync(join(incoming, STORIES_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  swapInto(incoming, featureStoriesDir(input.feature.id))
  // Only now, with a manifest naming it in place, may a new base build be
  // cached: a merge's sweep keeps exactly the bases some manifest references.
  if (pending && baseCommit) cacheBase(pending, baseCommit)

  const counts = countKinds(stories)
  emitBuilt(
    input,
    'stories.built',
    `UI states built: ${counts.changed} changed, ${counts.new} new, ${counts.affected} also affected`,
    counts,
  )
  return { status: 'built', commit: sha, baseCommit, base: base.status, counts }
}

// ---------------------------------------------------------------------------
// The branch point's build (decision 6)
// ---------------------------------------------------------------------------

interface ResolvedBase {
  /** The branch point, or null when the feature's base does not resolve. */
  commit: string | null
  base: StoriesBase
  /** A fresh build waiting to be cached at `baseStoriesDir(commit)`. */
  pending?: string
  /** A failed build's output, kept beside the feature's. */
  log?: string
}

/**
 * The branch point's catalogue: reused when cached by commit, else built with
 * that commit's own `stories.json`. A failure here is not a failed gate — the
 * section just shows changed stories without their "before".
 */
async function resolveBase(input: StoriesBuildInput): Promise<ResolvedBase> {
  const { project, feature, sha } = input
  const commit = feature.baseBranch ? await mergeBase(project.repoPath, feature.baseBranch, sha) : null
  if (!commit) return { commit: null, base: { status: 'none' } }

  const cached = readIndex(join(baseStoriesDir(commit), 'index.json'))
  if (cached) return { commit, base: { status: 'built', index: cached } }

  const cfg = await readStoriesConfigAt(project.repoPath, commit)
  if (!cfg) return { commit, base: { status: 'none' } }

  const timeoutMs = input.deps?.commandTimeoutMs ?? GATE_COMMAND_TIMEOUT_MS
  const withSandbox = input.deps?.withSandbox ?? burnGateSandbox(input.config, project)
  const branch = storiesBaseBranch(input.ticket.id)
  const out = incomingDir(`base-${commit.slice(0, 12)}`)
  let log: string
  try {
    const result = await withThrowawayBranch(project.repoPath, branch, commit, () =>
      withSandbox(
        branch,
        (sandbox) => execWithTimeout(sandbox, renderStoriesBuildCommand(cfg, sandbox.outPath ?? out), timeoutMs),
        { outDir: out },
      ),
    )
    if (result === 'timeout') {
      log = `the base build ${timeoutReason(timeoutMs)}\n`
    } else {
      log = [result.stdout, result.stderr].filter(Boolean).join('\n')
      const index = result.exitCode === 0 ? readIndex(join(out, 'index.json')) : null
      if (index) {
        writeFileSync(join(out, STORIES_BUILD_LOG), log)
        return { commit, base: { status: 'built', index }, pending: out }
      }
      if (result.exitCode === 0) log = `${log}\n\nruncastle: the base build wrote no readable index.json\n`
    }
  } catch (err) {
    log = `the base build could not run: ${errorDetail(err)}\n`
  }
  removeQuietly(out)
  return { commit, base: { status: 'failed' }, log }
}

function cacheBase(pending: string, commit: string): void {
  const target = baseStoriesDir(commit)
  // Another feature with the same branch point may have cached it meanwhile.
  if (existsSync(join(target, 'index.json'))) return removeQuietly(pending)
  swapInto(pending, target)
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

function incomingDir(name: string): string {
  const dir = join(storiesRoot(), 'incoming', `${name}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function readBuildOutput(dir: string): { index: StoryIndex; stats: PreviewStats } | { problem: string } {
  const index = readIndex(join(dir, 'index.json'))
  if (!index) return { problem: 'the build wrote no readable index.json' }
  const statsPath = join(dir, 'preview-stats.json')
  if (!existsSync(statsPath)) return { problem: 'no preview-stats.json: the build command must pass --stats-json' }
  const stats = PreviewStats.safeParse(readJson(statsPath))
  if (!stats.success) return { problem: 'preview-stats.json is not a readable import list' }
  return { index, stats: stats.data }
}

function readIndex(path: string): StoryIndex | null {
  if (!existsSync(path)) return null
  const parsed = StoryIndex.safeParse(readJson(path))
  return parsed.success ? parsed.data : null
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * A failed or unrun build replaces the feature dir with just its manifest and
 * log (decision 5): no stale catalogue is ever shown beside a failure.
 */
function publishResult(input: StoriesBuildInput, incoming: string, manifest: StoriesManifest, log: string): void {
  rmSync(incoming, { recursive: true, force: true })
  mkdirSync(incoming, { recursive: true })
  writeFileSync(join(incoming, STORIES_BUILD_LOG), log)
  writeFileSync(join(incoming, STORIES_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  swapInto(incoming, featureStoriesDir(input.feature.id))
}

/** Replace `target` with `source`; a rename Windows refuses (EBUSY/EXDEV) falls back to copy. */
function swapInto(source: string, target: string): void {
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  try {
    renameSync(source, target)
  } catch {
    cpSync(source, target, { recursive: true })
    removeQuietly(source)
  }
}

function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort — leftovers under incoming/ are never served
  }
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** The branch's `stories.json` at `ref`, or null for every "no stories" case. */
async function readStoriesConfigAt(repoPath: string, ref: string): Promise<StoriesConfig | null> {
  try {
    return parseStoriesConfig(await simpleGit(repoPath).raw(['show', `${ref}:${STORIES_CONFIG_REL}`]))
  } catch {
    return null
  }
}

async function mergeBase(repoPath: string, baseBranch: string, sha: string): Promise<string | null> {
  try {
    const out = (await simpleGit(repoPath).raw(['merge-base', baseBranch, sha])).trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

/** The feature's own changes: the three-dot diff, as the scenarios listing takes it. */
async function changedFilesSince(repoPath: string, from: string | null, sha: string): Promise<string[]> {
  if (!from) return []
  try {
    const out = await simpleGit(repoPath).raw(['diff', '--name-only', `${from}...${sha}`])
    return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function manifestHead(input: StoriesBuildInput): Pick<
  StoriesManifest,
  'featureId' | 'commit' | 'lap' | 'reviewTicketId' | 'builtAt'
> {
  return {
    featureId: input.feature.id,
    commit: input.sha,
    lap: input.ticket.lap,
    reviewTicketId: input.ticket.id,
    builtAt: (input.deps?.now ?? Date.now)(),
  }
}

function failedManifest(input: StoriesBuildInput): StoriesManifest {
  return {
    ...manifestHead(input),
    baseCommit: null,
    base: 'none',
    status: 'failed',
    log: STORIES_BUILD_LOG,
    stories: [],
  }
}

function couldntRunManifest(input: StoriesBuildInput, reason: string): StoriesManifest {
  return { ...failedManifest(input), status: 'couldnt_run', reason }
}

function countKinds(stories: ClassifiedStory[]): { changed: number; new: number; affected: number } {
  const counts = { changed: 0, new: 0, affected: 0 }
  for (const story of stories) counts[story.kind]++
  return counts
}

function emitBuilt(input: StoriesBuildInput, type: string, message: string, data?: unknown): void {
  input.emit?.({ type, message, ...(data === undefined ? {} : { data }) })
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}
