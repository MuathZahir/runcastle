import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { LABEL_DATA_DIR, LABEL_PROJECT, LABEL_WORKER, type WorkerRow } from '@runcastle/core'
import { dataDir as installDataDir, sameDataDir } from '@runcastle/core/paths'
import { projects, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { emitProject } from '../services/events'
import { tryGetFeature } from '../services/repo'
import { agentHost } from '../threads/types'
import { type SandboxEngine, sandboxEngine } from './engine'
import { type ContainerFacts, type VolumeFacts, WORKER_CONTAINER_PREFIX, originsDir, ownershipOf } from './ownership'
import { emitWorker, isSettingUp, keepConversation, removeHalfMade, sandboxOf, updateWorker } from './service'
import { runtimeDirName } from './worker'

/**
 * The sweep (runcastle-cleans-up-after-itself decisions 5, 6, 7, 11): one pass
 * over everything runcastle may have left behind — containers, cache volumes,
 * worker bare copies and branches, old runtime folders, the retired burn
 * engine's worktrees — removing what this install owns and no longer needs,
 * by the ownership rule in {@link ownershipOf} and this install's worker rows.
 * It runs at server start, every hour, and (its container part) from a
 * drive's stop hook. Serialised, never throws: a removal that fails is a
 * `cleanup.failed` event, and one `cleanup.swept` event per project says
 * what went and the space it freed.
 */

const execFileP = promisify(execFile)

/** What one kind of removed thing is called in the timeline line. */
export interface Noun {
  one: string
  many: string
}

export const NOUNS = {
  container: { one: 'leftover container', many: 'leftover containers' },
  volume: { one: 'old cache volume', many: 'old cache volumes' },
  origin: { one: 'worker copy', many: 'worker copies' },
  branch: { one: 'worker branch', many: 'worker branches' },
  runtime: { one: 'old runtime folder', many: 'old runtime folders' },
  worktree: { one: 'old worktree', many: 'old worktrees' },
} as const satisfies Record<string, Noun>

/** How a sweep step says what it did. A project id it cannot name is undefined: the line goes on the install's oldest project. */
export interface SweepReport {
  /** This install's data folder. */
  readonly dataDir: string
  /** Every container on every engine this sweep reached, as listed before anything was removed. */
  readonly containers: readonly ContainerFacts[]
  /** One thing removed; `bytes` measured before the removal, undefined when it could not be. */
  removed(projectId: string | undefined, noun: Noun, bytes: number | undefined): void
  /** A removal that failed: it becomes part of the project's `cleanup.failed` line. */
  failed(projectId: string | undefined, what: string, err: unknown): void
}

/** One more thing the sweep cleans: given the report to tell what it removed. It may throw; the sweep turns that into a failure. */
export interface SweepStep {
  name: string
  run(ctx: AppCtx, report: SweepReport): Promise<void>
}

/**
 * The extension point: steps run after the built-in ones on every sweep
 * (sandbox images, review captures). Register with {@link registerSweepStep}.
 */
export const extraSweepSteps: SweepStep[] = []

/** Add a step to every sweep from now on; a step of the same name replaces the earlier one. */
export function registerSweepStep(step: SweepStep): void {
  const at = extraSweepSteps.findIndex((s) => s.name === step.name)
  if (at >= 0) extraSweepSteps[at] = step
  else extraSweepSteps.push(step)
}

export interface SweepOptions {
  /** This install's data folder; `dataDir()` by default. */
  dataDir?: string
  /** Whether a path exists (tests); `existsSync` by default. */
  exists?: (path: string) => boolean
}

export interface SweepResult {
  removed: number
  stopped: number
  failed: number
  freedBytes: number
}

let chain: Promise<unknown> = Promise.resolve()

/** Sweep for leftovers. Calls queue behind each other, so two never run at once; never rejects. */
export function sweepLeftovers(ctx: AppCtx, opts: SweepOptions = {}): Promise<SweepResult> {
  const next = chain.then(() => sweepOnce(ctx, opts))
  chain = next.catch(() => {})
  return next
}

/** Sweep once an hour from now; returns what stops it. The timer never holds the process open. */
export function startHourlySweep(ctx: AppCtx, everyMs = 60 * 60_000): () => void {
  const timer = setInterval(() => void sweepLeftovers(ctx), everyMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

// --- the tally ------------------------------------------------------------------

interface ProjectTally {
  counts: Map<Noun, number>
  bytes: number
  unknown: number
  failures: string[]
}

class Tally implements SweepReport {
  readonly byProject = new Map<string | undefined, ProjectTally>()
  stopped = 0
  containers: ContainerFacts[] = []
  /** Containers this sweep removed. */
  readonly gone = new Set<string>()
  constructor(readonly dataDir: string) {}

  private of(projectId: string | undefined): ProjectTally {
    let t = this.byProject.get(projectId)
    if (!t) this.byProject.set(projectId, (t = { counts: new Map(), bytes: 0, unknown: 0, failures: [] }))
    return t
  }

  removed(projectId: string | undefined, noun: Noun, bytes: number | undefined): void {
    const t = this.of(projectId)
    t.counts.set(noun, (t.counts.get(noun) ?? 0) + 1)
    if (bytes === undefined) t.unknown++
    else t.bytes += bytes
  }

  failed(projectId: string | undefined, what: string, err: unknown): void {
    this.of(projectId).failures.push(`${what}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  }
}

/** `1.2 GB`, `340 MB`, `12 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`
}

/** "Removed 3 leftover containers and 1 old image (11.2 GB)". */
export function sweptMessage(counts: ReadonlyMap<Noun, number>, bytes: number, unknown: number): string {
  const parts = [...counts].map(([noun, n]) => `${n} ${n === 1 ? noun.one : noun.many}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing')
  const size = unknown === 0 ? formatBytes(bytes) : bytes > 0 ? `at least ${formatBytes(bytes)}` : 'space freed unknown'
  return `Removed ${list} (${size})`
}

// --- the sweep ------------------------------------------------------------------

async function sweepOnce(ctx: AppCtx, opts: SweepOptions): Promise<SweepResult> {
  const dir = opts.dataDir ?? installDataDir()
  const exists = opts.exists ?? existsSync
  const tally = new Tally(dir)
  try {
    const rows = ctx.db.select().from(workers).all()
    const projectRows = ctx.db.select().from(projects).all()
    const projectIds = new Set(projectRows.map((p) => p.id))
    const project = (id: string | undefined): string | undefined => (id && projectIds.has(id) ? id : undefined)

    const engines = new Map<string, SandboxEngine>()
    for (const name of new Set([ctx.config.sandbox ?? 'docker', ...rows.map((r) => r.engine)])) {
      const engine = sandboxEngine(name)
      if (!engines.has(engine.name)) engines.set(engine.name, engine)
    }
    for (const engine of engines.values()) {
      if (!(await engine.available().catch(() => false))) continue
      let containers: ContainerFacts[]
      try {
        containers = await engine.listContainers()
      } catch (err) {
        tally.failed(undefined, `listing ${engine.name}'s containers`, err)
        continue
      }
      tally.containers.push(...containers)
      await sweepContainers(ctx, engine, containers, rows, tally, project, exists)
      await sweepVolumes(
        engine,
        containers.filter((c) => !tally.gone.has(c.name)),
        tally,
        projectIds,
        exists,
      )
    }
    await sweepOrigins(ctx, tally, rows)
    await sweepBranches(ctx, tally, rows, projectRows)
    sweepRuntimeDirs(tally)
    await sweepSandcastleWorktrees(ctx, tally, projectRows)
    for (const step of extraSweepSteps) {
      try {
        await step.run(ctx, tally)
      } catch (err) {
        tally.failed(undefined, step.name, err)
      }
    }
  } catch (err) {
    tally.failed(undefined, 'the sweep', err)
  }
  return report(ctx, tally)
}

/** Each project's line: one `cleanup.swept` for what went, one `cleanup.failed` for what would not go. */
function report(ctx: AppCtx, tally: Tally): SweepResult {
  const result: SweepResult = { removed: 0, stopped: tally.stopped, failed: 0, freedBytes: 0 }
  // What no project of this install made (another install's orphans, the burn engine's) goes on its oldest project.
  const fallback = ctx.db.select({ id: projects.id }).from(projects).limit(1).get()?.id
  const merged = new Map<string, ProjectTally>()
  for (const [id, t] of tally.byProject) {
    const to = id ?? fallback
    const removed = [...t.counts.values()].reduce((a, b) => a + b, 0)
    result.removed += removed
    result.failed += t.failures.length
    result.freedBytes += t.bytes
    if (!to) {
      if (removed + t.failures.length) console.log(`cleanup: ${sweptMessage(t.counts, t.bytes, t.unknown)}${t.failures.length ? `; failed: ${t.failures.join('; ')}` : ''}`)
      continue
    }
    const m: ProjectTally = merged.get(to) ?? { counts: new Map(), bytes: 0, unknown: 0, failures: [] }
    for (const [noun, n] of t.counts) m.counts.set(noun, (m.counts.get(noun) ?? 0) + n)
    m.bytes += t.bytes
    m.unknown += t.unknown
    m.failures.push(...t.failures)
    merged.set(to, m)
  }
  for (const [projectId, t] of merged) {
    try {
      if (t.counts.size) {
        emitProject(ctx, projectId, {
          type: 'cleanup.swept',
          message: sweptMessage(t.counts, t.bytes, t.unknown),
          data: { removed: Object.fromEntries([...t.counts].map(([noun, n]) => [noun.many, n])), freedBytes: t.bytes, sizeUnknown: t.unknown },
        })
      }
      if (t.failures.length) {
        emitProject(ctx, projectId, {
          type: 'cleanup.failed',
          message: `Cleanup could not remove ${t.failures.length} thing${t.failures.length === 1 ? '' : 's'}: ${t.failures.join('; ').slice(0, 1500)}`,
          data: { failures: t.failures },
        })
      }
    } catch (err) {
      console.error('cleanup: could not record the sweep', err)
    }
  }
  return result
}

const TERMINAL = new Set(['landed', 'dropped'])

/** Whether a worker row's sandbox is no longer needed: landed, dropped, failed during setup, or its feature closed or gone. */
function sandboxDone(ctx: AppCtx, w: WorkerRow): boolean {
  if (TERMINAL.has(w.status)) return true
  if (!w.branch && !isSettingUp(w.id)) return true
  if (w.featureId === null) return false
  const f = tryGetFeature(ctx, w.featureId)
  return !f || f.status === 'shipped' || f.status === 'archived'
}

/** The branch a worker container's name stands for. */
function plannedBranch(container: string): string {
  return `runcastle/worker/${container.slice(WORKER_CONTAINER_PREFIX.length)}`
}

/** Remove, or stop, each container this install owns and no longer needs; orphans and the burn engine's go too. */
async function sweepContainers(
  ctx: AppCtx,
  engine: SandboxEngine,
  containers: ContainerFacts[],
  rows: WorkerRow[],
  tally: Tally,
  project: (id: string | undefined) => string | undefined,
  exists: (path: string) => boolean,
): Promise<void> {
  const gone = tally.gone
  const host = agentHost(ctx)
  for (const c of containers) {
    const owner = ownershipOf(c, tally.dataDir, exists)
    if (owner === 'foreign') continue
    const projectId = project(c.labels[LABEL_PROJECT])
    try {
      if (owner === 'orphan' || owner === 'burn-engine') {
        await engine.removeContainer(c.name)
        gone.add(c.name)
        tally.removed(projectId, NOUNS.container, c.sizeBytes)
        continue
      }
      // This install's own: only worker containers are the sweep's.
      if (!c.name.startsWith(WORKER_CONTAINER_PREFIX)) continue
      const labelled = c.labels[LABEL_WORKER]
      const row = rows.find((r) => r.container === c.name) ?? (labelled ? rows.find((r) => r.id === labelled) : undefined)
      if (row && (host.isRunning(row.id) || isSettingUp(row.id))) continue
      if (!row) {
        await engine.removeContainer(c.name)
        gone.add(c.name)
        tally.removed(projectId, NOUNS.container, c.sizeBytes)
        continue
      }
      if (sandboxDone(ctx, row)) {
        await removeRowContainer(ctx, engine, row, c)
        gone.add(c.name)
        tally.removed(project(row.projectId), NOUNS.container, c.sizeBytes)
        continue
      }
      if (!c.running) continue
      const sb = sandboxOf(ctx, row)
      if (sb) await engine.stop(sb)
      else await engine.stopContainers([c.name])
      tally.stopped++
      emitWorker(ctx, row, 'worker.stopped', `worker "${row.label}" sandbox stopped (server restart)`, { reason: 'restart' })
    } catch (err) {
      tally.failed(projectId, `container ${c.name}`, err)
    }
  }
}

/** A worker row's container: its conversation kept first, then it, its branch and bare copy removed. A setup the last server cut off fails the worker. */
async function removeRowContainer(ctx: AppCtx, engine: SandboxEngine, row: WorkerRow, c: ContainerFacts): Promise<void> {
  if (!row.branch && !TERMINAL.has(row.status) && row.status !== 'failed') {
    const failure = 'its sandbox setup was cut off by a server restart'
    const failed = updateWorker(ctx, row.id, { status: 'failed', failure })
    emitWorker(ctx, failed, 'worker.failed', `worker "${row.label}" failed: ${failure}`, { failure, from: row.status })
  }
  const sb = row.branch ? safeSandboxOf(ctx, row) : null
  if (sb) {
    await keepConversation(ctx, row)
    await engine.remove(sb)
    return
  }
  if (row.featureId !== null && tryGetFeature(ctx, row.featureId)) await removeHalfMade(ctx, { ...row, container: c.name }, plannedBranch(c.name))
  if (await engine.inspect(c.name).catch(() => undefined)) await engine.removeContainer(c.name)
}

function safeSandboxOf(ctx: AppCtx, row: WorkerRow): ReturnType<typeof sandboxOf> {
  try {
    return sandboxOf(ctx, row)
  } catch {
    return null
  }
}

/** Legacy shared cache volume, made before each project had its own. */
export const LEGACY_CACHE_VOLUME = 'runcastle-worker-cache'

/** Cache volumes of projects this install no longer has, the legacy shared one, and any of a gone install: none still mounted. */
async function sweepVolumes(engine: SandboxEngine, containers: ContainerFacts[], tally: Tally, projectIds: ReadonlySet<string>, exists: (path: string) => boolean): Promise<void> {
  let volumes: VolumeFacts[]
  try {
    volumes = await engine.listVolumes()
  } catch (err) {
    tally.failed(undefined, `listing ${engine.name}'s volumes`, err)
    return
  }
  const mounted = new Set(containers.flatMap((c) => c.mounts.filter((m) => m.type === 'volume').map((m) => m.source)))
  for (const v of volumes) {
    if (mounted.has(v.name)) continue
    const labelled = v.labels[LABEL_DATA_DIR]
    const projectId = v.labels[LABEL_PROJECT] ?? v.name.match(/^runcastle-(proj_[A-Za-z0-9_-]+)$/)?.[1]
    let gone: boolean
    if (labelled && !sameDataDir(labelled, tally.dataDir)) gone = !exists(labelled)
    else if (v.name === LEGACY_CACHE_VOLUME) gone = true
    else gone = projectId !== undefined && !projectIds.has(projectId)
    if (!gone) continue
    try {
      await engine.removeVolume(v.name)
      tally.removed(undefined, NOUNS.volume, v.sizeBytes)
    } catch (err) {
      tally.failed(undefined, `volume ${v.name}`, err)
    }
  }
}

/** Bytes under `path` by `du`, best effort: undefined where it cannot say. */
export async function folderBytes(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileP('du', ['-sk', path], { maxBuffer: 1024 * 1024 })
    const kb = Number(stdout.trim().split(/\s+/)[0])
    return Number.isFinite(kb) ? kb * 1024 : undefined
  } catch {
    return undefined
  }
}

function isUnder(path: string, dir: string): boolean {
  const p = resolve(path)
  const d = resolve(dir)
  return p === d || p.startsWith(d.endsWith(sep) ? d : d + sep)
}

/** Whether a container this sweep did not remove mounts `dir` or something under it. */
function mountedFrom(tally: Tally, dir: string): boolean {
  return tally.containers.some((c) => !tally.gone.has(c.name) && c.mounts.some((m) => m.type === 'bind' && isUnder(m.source, dir)))
}

/** Workers' bare copies whose worker is unknown, or whose sandbox is no longer needed. */
async function sweepOrigins(ctx: AppCtx, tally: Tally, rows: WorkerRow[]): Promise<void> {
  const dir = originsDir(tally.dataDir)
  if (!existsSync(dir)) return
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.git')) continue
    const id = name.slice(0, -'.git'.length)
    const row = byId.get(id)
    const path = join(dir, name)
    if (row && (isSettingUp(row.id) || !sandboxDone(ctx, row))) continue
    // A container whose removal failed still mounts it: it goes with that container, at a later sweep.
    if (mountedFrom(tally, path)) continue
    const bytes = await folderBytes(path)
    try {
      rmSync(path, { recursive: true, force: true })
      tally.removed(row?.projectId, NOUNS.origin, bytes)
    } catch (err) {
      tally.failed(row?.projectId, `worker copy ${path}`, err)
    }
  }
}

async function git(repo: string, args: string[]): Promise<string> {
  return (await execFileP('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout
}

/** `runcastle/worker/*` branches in each project's repo whose worker is unknown or whose sandbox is no longer needed. */
async function sweepBranches(ctx: AppCtx, tally: Tally, rows: WorkerRow[], projectRows: { id: string; repoPath: string }[]): Promise<void> {
  for (const p of projectRows) {
    if (!existsSync(p.repoPath)) continue
    let branches: string[]
    try {
      branches = (await git(p.repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/runcastle/worker/'])).split('\n').map((b) => b.trim()).filter(Boolean)
    } catch {
      continue
    }
    for (const branch of branches) {
      const row = rows.find((r) => r.branch === branch || (r.container !== null && plannedBranch(r.container) === branch))
      if (row && (isSettingUp(row.id) || !sandboxDone(ctx, row))) continue
      try {
        await git(p.repoPath, ['branch', '-D', branch])
        tally.removed(p.id, NOUNS.branch, 0)
      } catch (err) {
        tally.failed(p.id, `branch ${branch}`, err)
      }
    }
  }
}

/** Adapter bundles of earlier runcastle versions no container still mounts. */
function sweepRuntimeDirs(tally: Tally): void {
  const dir = join(tally.dataDir, 'workers', 'runtime')
  if (!existsSync(dir)) return
  const current = runtimeDirName()
  for (const name of readdirSync(dir)) {
    if (name === current) continue
    const path = join(dir, name)
    if (mountedFrom(tally, path)) continue
    try {
      rmSync(path, { recursive: true, force: true })
      tally.removed(undefined, NOUNS.runtime, undefined)
    } catch (err) {
      tally.failed(undefined, `runtime folder ${path}`, err)
    }
  }
}

/**
 * The retired burn engine's worktrees inside each project's repo
 * (`.sandcastle/worktrees/*`, decision 7): removed when `git status` shows
 * nothing uncommitted; the others are named in one `cleanup.kept` line, said
 * again only when that list changes.
 */
async function sweepSandcastleWorktrees(ctx: AppCtx, tally: Tally, projectRows: { id: string; repoPath: string }[]): Promise<void> {
  const keptFile = join(tally.dataDir, 'cleanup', 'sandcastle-kept.json')
  let said: Record<string, string[]> = {}
  try {
    said = JSON.parse(readFileSync(keptFile, 'utf8')) as Record<string, string[]>
  } catch {}
  let changed = false
  for (const p of projectRows) {
    const root = join(p.repoPath, '.sandcastle', 'worktrees')
    if (!existsSync(root)) continue
    const dirty: string[] = []
    for (const name of readdirSync(root)) {
      const wt = join(root, name)
      let clean: boolean
      try {
        clean = (await git(wt, ['status', '--porcelain'])).trim() === ''
      } catch {
        clean = false
      }
      if (!clean) {
        dirty.push(wt)
        continue
      }
      const bytes = await folderBytes(wt)
      try {
        await git(p.repoPath, ['worktree', 'remove', '--force', wt]).catch(async () => {
          rmSync(wt, { recursive: true, force: true })
          await git(p.repoPath, ['worktree', 'prune']).catch(() => {})
        })
        tally.removed(p.id, NOUNS.worktree, bytes)
      } catch (err) {
        tally.failed(p.id, `worktree ${wt}`, err)
      }
    }
    const before = (said[p.id] ?? []).join('\n')
    if (dirty.join('\n') === before) continue
    said[p.id] = dirty
    changed = true
    if (dirty.length) {
      emitProject(ctx, p.id, {
        type: 'cleanup.kept',
        message: `Kept ${dirty.length} old worktree${dirty.length === 1 ? '' : 's'} with uncommitted changes: ${dirty.join(', ')}`,
        data: { worktrees: dirty },
      })
    }
  }
  if (!changed) return
  try {
    mkdirSync(dirname(keptFile), { recursive: true })
    writeFileSync(keptFile, JSON.stringify(said))
  } catch {}
}

// --- outside the sweep ----------------------------------------------------------

/**
 * Stop every running worker container this install owns, at once (server
 * shutdown, decision 4). Best effort: what it misses, the next start's sweep
 * stops. Never another install's.
 */
export async function stopOwnWorkerContainers(ctx: AppCtx, seconds = 3): Promise<number> {
  const engine = sandboxEngine(ctx.config.sandbox)
  try {
    const dir = installDataDir()
    const running = (await engine.listContainers())
      .filter((c) => c.running && c.name.startsWith(WORKER_CONTAINER_PREFIX) && ownershipOf(c, dir) === 'own')
      .map((c) => c.name)
    await engine.stopContainers(running, seconds)
    return running.length
  } catch (err) {
    console.error('shutdown: could not stop the worker containers', err)
    return 0
  }
}

/**
 * Remove every container and volume labelled with `dataDir` (a drive's stop
 * hook, decision 6, before it deletes that data folder). Containers go first,
 * so their volumes are no longer mounted. Never throws; returns what went and
 * what would not.
 */
export async function removeInstallResources(
  engine: Pick<SandboxEngine, 'listContainers' | 'listVolumes' | 'removeContainer' | 'removeVolume'>,
  dataDir: string,
): Promise<{ containers: string[]; volumes: string[]; failed: string[] }> {
  const out = { containers: [] as string[], volumes: [] as string[], failed: [] as string[] }
  const ours = (labels: Record<string, string>): boolean => {
    const d = labels[LABEL_DATA_DIR]
    return d !== undefined && sameDataDir(d, dataDir)
  }
  try {
    for (const c of await engine.listContainers()) {
      if (!ours(c.labels)) continue
      try {
        await engine.removeContainer(c.name)
        out.containers.push(c.name)
      } catch (err) {
        out.failed.push(`container ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    for (const v of await engine.listVolumes()) {
      if (!ours(v.labels)) continue
      try {
        await engine.removeVolume(v.name)
        out.volumes.push(v.name)
      } catch (err) {
        out.failed.push(`volume ${v.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    out.failed.push(err instanceof Error ? err.message : String(err))
  }
  return out
}
