import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { LABEL_DATA_DIR, LABEL_DOCKERFILE_HASH, LABEL_OWNER, LABEL_PROJECT, LABEL_WORKER, OWNER_VALUE, type WorkerRow } from '@runcastle/core'
import { dataDir as installDataDir, sameDataDir } from '@runcastle/core/paths'
import { sql } from 'drizzle-orm'
import { projects, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { getSessionRow } from '../launcher/sessions'
import { emitProject } from '../services/events'
import { readTranscriptUsage } from '../services/usage'
import { isHostWorker } from './drive'
import { failWorker, keptConversationPath, updateWorker } from './service'
import { folderBytes, formatBytes } from './sweep'

/**
 * The upgrade step (sandboxes-are-removed decisions 3 and 4): the only code
 * left that calls Docker or Podman. It runs once per install, at the first
 * boot after the upgrade, and records that it ran in the data folder.
 *
 * - Every worker that was still in a container is closed: its commits are
 *   fetched from its copy in the data folder onto its branch in the project
 *   repo, and it is failed through the usual path, which tells its lead. Its
 *   container is left in place, since it may hold uncommitted edits.
 * - What this install made for containers is removed only when it belongs to a
 *   worker that finished, landed or dropped (the human, on decision 3: "just
 *   make sure this doesnt affect existing work in runcastle"): those workers'
 *   containers and project copies, the images and cache volumes nothing kept
 *   needs, its image builders and the runtime folders. Anything that may hold
 *   unfinished work (a container or copy of a worker that is not landed or
 *   dropped, or whose worker is unknown, the volumes of its project, the image
 *   it was made from) is kept and named with the command that removes it.
 *
 * Every container call is best effort with a timeout: a failure becomes part
 * of the event, never a failed boot. A later release may delete this module.
 */

/** One container CLI call's result; `code` is null when the binary could not run or timed out. */
export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs `bin args`, never rejects. Injected by tests as a fake container CLI. */
export type CliRun = (bin: string, args: string[], timeoutMs: number) => Promise<CliResult>

export interface LeftoversDeps {
  dataDir?: string
  run?: CliRun
  platform?: NodeJS.Platform
}

export interface LeftoversOutcome {
  /** False when the step had already run on this install. */
  ran: boolean
  /** The container binary that answered, or null when none did. */
  bin: string | null
  /** The workers closed because they were still in a container. */
  closed: string[]
  /** What was removed, as `<kind> <name>`. */
  things: string[]
  /** What was kept because it may hold unfinished work, as `<kind> <name>`. */
  kept: string[]
  /** The exact commands named to the user: what removes each kept thing, and Docker's shared build cache when large. */
  commands: string[]
  bytes: number
  failures: string[]
}

const MARKER = 'container-leftovers.json'
const OLD_CONTAINER_PREFIX = 'runcastle-worker-'
const ORIGIN_MOUNT = '/home/agent/origin.git'
const LEGACY_CACHE_VOLUME = 'runcastle-worker-cache'
const STOCK_IMAGE = 'sandcastle:runcastle'
const BUILDER_PREFIX = 'runcastle-build-'
/** The names the retired burn engine gave its containers: sandcastle's own and the burner's. */
const BURN_ENGINE_NAME = /^(sandcastle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|runcastle-run_[A-Za-z0-9_-]+-t\d+)$/
const UNFINISHED = new Set<WorkerRow['status']>(['working', 'queued', 'needs-you', 'stalled', 'handed-back'])
/** The only statuses whose container and copy may go: the worker's work landed, or its lead dropped it. A failed worker's work may never have landed. */
const FINISHED = new Set<WorkerRow['status']>(['landed', 'dropped'])
const QUICK = 30_000
const SLOW = 120_000
/** Docker's shared build cache is named only when it holds at least this much. */
const BUILD_CACHE_WORTH_NAMING = 1e9

const execFileP = promisify(execFile)

/** The real CLI: `execFile` with a timeout; never rejects. */
export const runCli: CliRun = (bin, args, timeoutMs) =>
  new Promise((done) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0
      done({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && code === null ? err.message : '') })
    })
  })

/** A worker that ran in a container: every worker started since workers moved to the host has a folder, is a drive worker or a drive review. */
export function isContainerWorker(w: WorkerRow): boolean {
  return !isHostWorker(w)
}

interface Marker {
  /** `closed` once unfinished workers are closed; `done` once the whole step ran. */
  stage: 'closed' | 'done'
  closed: string[]
  at: number
}

function readMarker(path: string): Marker | null {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8')) as Partial<Marker>
    return { stage: m.stage === 'closed' ? 'closed' : 'done', closed: Array.isArray(m.closed) ? m.closed.filter((x): x is string => typeof x === 'string') : [], at: Number(m.at) || 0 }
  } catch {
    return null
  }
}

function writeMarker(path: string, marker: Marker): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(marker, null, 2))
  } catch (err) {
    console.error('container leftovers: could not record that the upgrade step ran', err)
  }
}

/**
 * Start the upgrade step. `closed` settles once every worker still in a
 * container is closed (boot waits on it before waking cut-off threads);
 * `done` settles with what the whole step did. Neither rejects.
 */
export function startContainerLeftovers(ctx: AppCtx, deps: LeftoversDeps = {}): { closed: Promise<void>; done: Promise<LeftoversOutcome> } {
  let closedSettled: () => void = () => {}
  const closed = new Promise<void>((r) => (closedSettled = r))
  const done = runLeftovers(ctx, deps, () => closedSettled())
    .catch((err): LeftoversOutcome => {
      console.error('container leftovers: the upgrade step failed', err)
      return { ran: true, bin: null, closed: [], things: [], kept: [], commands: [], bytes: 0, failures: [errText(err)] }
    })
    .finally(() => closedSettled())
  return { closed, done }
}

function errText(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err)
}

interface Container {
  id: string
  name: string
  labels: Record<string, string>
  mounts: { type: string; source: string; destination: string }[]
  image: string
  sizeBytes?: number
}

interface Thing {
  kind: 'container' | 'image' | 'volume' | 'builder' | 'folder'
  /** What the command and the message name it by. */
  name: string
  bytes?: number
  projectId?: string
  /** The worker a container or a project copy belongs to; a finished one's conversation is kept before its container goes. */
  workerId?: string
  /** An image's id, to match the images containers that stay were made from. */
  imageId?: string
}

async function runLeftovers(ctx: AppCtx, deps: LeftoversDeps, onClosed: () => void): Promise<LeftoversOutcome> {
  const dir = deps.dataDir ?? installDataDir()
  const run = deps.run ?? runCli
  const platform = deps.platform ?? process.platform
  const markerPath = join(dir, MARKER)
  const marker = readMarker(markerPath)
  const out: LeftoversOutcome = { ran: false, bin: null, closed: [], things: [], kept: [], commands: [], bytes: 0, failures: [] }
  if (marker?.stage === 'done') {
    onClosed()
    return out
  }
  out.ran = true

  // Which binary answers, and what containers it holds.
  let bin: string | null = null
  /** A binary that is installed but did not answer, such as Docker with its daemon stopped. */
  let silent: string | null = null
  let ids: string[] = []
  for (const candidate of ['docker', 'podman']) {
    const ps = await run(candidate, ['ps', '-aq', '--no-trunc'], QUICK)
    if (ps.code === 0) {
      bin = candidate
      ids = lines(ps.stdout)
      break
    }
    if (ps.code !== null) silent ??= candidate
  }
  out.bin = bin
  let containers: Container[] = []
  let listed = true
  if (bin && ids.length) {
    const inspected = await run(bin, ['container', 'inspect', '--size', ...ids], SLOW)
    if (inspected.code === 0) containers = parseContainers(inspected.stdout)
    else {
      listed = false
      out.failures.push(`listing ${bin}'s containers: ${inspected.stderr.trim().split('\n')[0] || `exit ${inspected.code}`}`)
    }
  }
  const projectRows = ctx.db.select().from(projects).orderBy(sql`rowid`).all()
  const projectIds = new Set(projectRows.map((p) => p.id))
  const own = containers.filter((c) => ownsContainer(c, dir))
  const workerOf = (c: Container): string | undefined => c.labels[LABEL_WORKER] ?? originWorker(c)

  // (a) Close every worker still in a container: its commits onto its branch, then failed (which tells its lead).
  const closedIds = new Set(marker?.closed ?? [])
  if (!marker) {
    const rows = ctx.db.select().from(workers).all().filter((w) => UNFINISHED.has(w.status) && isContainerWorker(w))
    for (const w of rows) {
      const repo = projectRows.find((p) => p.id === w.projectId)?.repoPath
      const container = own.find((c) => workerOf(c) === w.id)?.name
      const reason = await keepCommits(dir, w, repo)
      const left = container && bin ? ` Its container ${container} is left in place, since it may hold uncommitted edits: \`${bin} rm -f ${container}\` removes it.` : ''
      try {
        await failWorker(ctx, w, `it ran in a container, which runcastle no longer has; ${reason}.${left}`)
      } catch (err) {
        out.failures.push(`closing worker ${w.id}: ${errText(err)}`)
      }
      closedIds.add(w.id)
      out.closed.push(w.id)
    }
    writeMarker(markerPath, { stage: 'closed', closed: [...closedIds], at: Date.now() })
  }
  onClosed()

  // (b) Nothing answers, or its containers could not be read: remove nothing, since what is in use is unknown.
  // With no docker or podman installed the step is done; one that is installed but silent is tried again on the next start.
  if (!bin || !listed) {
    const retry = !listed || silent !== null
    if (retry) out.failures.push(`${listed ? `${silent} did not answer` : 'nothing was removed'}; the next start looks again`)
    if (!marker) report(ctx, out, projectRows, closedIds, { removed: [], kept: [], unknown: 0 })
    if (!retry) writeMarker(markerPath, { stage: 'done', closed: [...closedIds], at: Date.now() })
    return out
  }

  // (c) What this install made, and what of it may hold unfinished work.
  const rows = ctx.db.select().from(workers).all()
  /** Only a known worker that landed or was dropped is finished; anything unsure is not. */
  const finished = (workerId: string | undefined): boolean => {
    const status = workerId && !closedIds.has(workerId) ? rows.find((r) => r.id === workerId)?.status : undefined
    return status !== undefined && FINISHED.has(status)
  }
  const keptContainers = own.filter((c) => !finished(workerOf(c)))
  const goingNames = new Set(own.filter((c) => !keptContainers.includes(c)).map((c) => c.name))
  const staying = containers.filter((c) => !goingNames.has(c.name))
  const inUse = new Set(staying.map((c) => normaliseId(c.image)))
  const mounted = new Set(staying.flatMap((c) => c.mounts.filter((m) => m.type === 'volume').map((m) => m.source)))
  const projectOfWorker = (id: string | undefined): string | undefined => rows.find((r) => r.id === id)?.projectId
  const keptProjects = new Set([
    ...keptContainers.map((c) => c.labels[LABEL_PROJECT] ?? projectOfWorker(workerOf(c))),
    ...[...closedIds].map(projectOfWorker),
  ].filter((p): p is string => !!p))

  const owned: Thing[] = own.map((c) => {
    const workerId = workerOf(c)
    const projectId = c.labels[LABEL_PROJECT] ?? projectOfWorker(workerId)
    return { kind: 'container', name: c.name, bytes: c.sizeBytes, ...(projectId ? { projectId } : {}), ...(workerId ? { workerId } : {}) }
  })
  owned.push(...(await ownImages(run, bin, dir, projectIds, out)))
  owned.push(...(await ownVolumes(run, bin, dir, projectIds, out)))
  if (bin === 'docker') owned.push(...(await ownBuilders(run, dir)))
  owned.push(...(await ownFolders(dir)))
  const keep = (t: Thing): boolean => {
    switch (t.kind) {
      case 'container':
        return !goingNames.has(t.name)
      case 'image':
        return !!t.imageId && inUse.has(t.imageId)
      case 'volume':
        // A project's cache stays with its kept containers; the old shared one while any is kept.
        return mounted.has(t.name) || (t.name === LEGACY_CACHE_VOLUME ? keptContainers.length > 0 : !t.projectId || keptProjects.has(t.projectId))
      case 'folder':
        // A project copy stays unless its worker finished; the runtime folders hold no work.
        return t.workerId !== undefined && !finished(t.workerId)
      case 'builder':
        return false
    }
  }
  const kept = owned.filter(keep)
  const going = owned.filter((t) => !keep(t))
  const buildCache = bin === 'docker' ? await buildCacheBytes(run) : undefined

  // (d) Remove what goes; name what stays.
  let unknown = 0
  const removed: Thing[] = []
  for (const t of going) {
    try {
      if (t.kind === 'container' && t.workerId) await keepConversationOutOf(ctx, run, bin, t.name, t.workerId)
      await removeThing(run, bin, t)
    } catch (err) {
      out.failures.push(`${t.kind} ${t.name}: ${errText(err)}`)
      continue
    }
    removed.push(t)
    out.things.push(`${t.kind} ${t.name}`)
    out.bytes += t.bytes ?? 0
    if (t.bytes === undefined) unknown++
  }
  removeIfEmpty(join(dir, 'workers', 'origins'))
  removeIfEmpty(join(dir, 'workers'))
  out.kept = kept.map((t) => `${t.kind} ${t.name}`)
  out.commands = removeCommands(bin, kept, platform)
  const nameCache = buildCache !== undefined && buildCache >= BUILD_CACHE_WORTH_NAMING
  if (nameCache) out.commands.push('docker builder prune')

  // (e) One log line and one project event.
  report(ctx, out, projectRows, closedIds, { removed, kept, unknown, ...(nameCache ? { buildCache } : {}) })
  writeMarker(markerPath, { stage: 'done', closed: [...closedIds], at: Date.now() })
  return out
}

// --- closing a worker that was in a container ----------------------------------

/** Fetch a container worker's commits from its copy in the data folder onto its branch in the project repo; says where they are. */
async function keepCommits(dir: string, w: WorkerRow, repo: string | undefined): Promise<string> {
  if (!w.branch) return 'it had not started building, so it made no commits'
  const origin = join(dir, 'workers', 'origins', `${w.id}.git`)
  if (!existsSync(origin)) return `its copy of its commits (${origin}) is missing, so none could be kept`
  if (!repo || !existsSync(repo)) return `its project's repo is missing, so its commits stay in ${origin}`
  try {
    await execFileP('git', ['-C', repo, 'fetch', '-q', origin, `+refs/heads/${w.branch}:refs/heads/${w.branch}`], { timeout: SLOW, windowsHide: true })
    return `its commits are on branch ${w.branch}`
  } catch (err) {
    return `its commits could not be fetched onto a branch (${errText(err)}), so they stay in ${origin}`
  }
}

// --- reading what the container CLI holds ---------------------------------------

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function normaliseId(id: string): string {
  return id.replace(/^sha256:/, '')
}

interface RawContainer {
  Id?: string
  Name?: string
  Image?: string
  Config?: { Labels?: Record<string, string> | null }
  Mounts?: { Type?: string; Source?: string; Name?: string; Destination?: string }[] | null
  SizeRw?: number
}

function parseContainers(json: string): Container[] {
  let raw: RawContainer[]
  try {
    raw = JSON.parse(json) as RawContainer[]
  } catch {
    return []
  }
  return raw.map((r) => ({
    id: r.Id ?? '',
    name: (r.Name ?? '').replace(/^\//, ''),
    labels: r.Config?.Labels ?? {},
    // A named volume's source is its name; a bind's is the host path.
    mounts: (r.Mounts ?? []).map((m) => ({ type: m.Type ?? '', source: m.Type === 'volume' && m.Name ? m.Name : (m.Source ?? ''), destination: m.Destination ?? '' })),
    image: r.Image ?? '',
    ...(typeof r.SizeRw === 'number' ? { sizeBytes: r.SizeRw } : {}),
  }))
}

function isUnder(path: string, folder: string): boolean {
  const d = resolve(folder)
  return resolve(path).startsWith(d.endsWith(sep) ? d : d + sep)
}

/** The worker a container made before the labels belongs to, from the copy mounted into it (`<dataDir>/workers/origins/<id>.git`). */
function originWorker(c: Container): string | undefined {
  if (!c.name.startsWith(OLD_CONTAINER_PREFIX)) return undefined
  const origin = c.mounts.find((m) => m.destination === ORIGIN_MOUNT)?.source
  return origin ? basename(origin).replace(/\.git$/, '') : undefined
}

/**
 * Whether this install made a container: labelled with runcastle's owner and
 * this data folder; a worker container made before the labels, whose copy
 * mount lies in this data folder; or a container of the retired burn engine
 * (its own names, from a runcastle image) that names no other install.
 */
function ownsContainer(c: Container, dir: string): boolean {
  const labelled = c.labels[LABEL_DATA_DIR]
  if (labelled) return sameDataDir(labelled, dir) && (c.labels[LABEL_OWNER] ?? OWNER_VALUE) === OWNER_VALUE
  if (c.name.startsWith(OLD_CONTAINER_PREFIX)) {
    const origin = c.mounts.find((m) => m.destination === ORIGIN_MOUNT)?.source
    return !!origin && isUnder(origin, join(dir, 'workers', 'origins'))
  }
  return !!c.labels[LABEL_DOCKERFILE_HASH] && BURN_ENGINE_NAME.test(c.name)
}

/** A tag runcastle built under, without Podman's `localhost/`: the stock image or a project's. */
function bareTag(tag: string): string {
  return tag.replace(/^localhost\//, '')
}

/**
 * Runcastle's images of this install: built by runcastle (the Dockerfile-hash
 * label), wearing only runcastle's tags, and either labelled with this data
 * folder or, unlabelled, the stock image or one of this install's projects'.
 */
async function ownImages(run: CliRun, bin: string, dir: string, projectIds: ReadonlySet<string>, out: LeftoversOutcome): Promise<Thing[]> {
  const listed = await run(bin, ['images', '-q', '--no-trunc', '--filter', `label=${LABEL_DOCKERFILE_HASH}`], QUICK)
  if (listed.code !== 0) {
    out.failures.push(`listing ${bin}'s images: ${listed.stderr.trim().split('\n')[0] || `exit ${listed.code}`}`)
    return []
  }
  const ids = [...new Set(lines(listed.stdout))]
  if (!ids.length) return []
  const inspected = await run(bin, ['image', 'inspect', '--format', '{{.Id}}\t{{.Size}}\t{{json .RepoTags}}\t{{json .Config.Labels}}', ...ids], QUICK)
  if (inspected.code !== 0) {
    out.failures.push(`reading ${bin}'s images: ${inspected.stderr.trim().split('\n')[0] || `exit ${inspected.code}`}`)
    return []
  }
  const things: Thing[] = []
  for (const line of lines(inspected.stdout)) {
    const [id = '', size, tagsJson, labelsJson] = line.split('\t')
    const tags = (parseJson(tagsJson) as unknown[] | null ?? []).filter((t): t is string => typeof t === 'string' && !t.includes('<none>'))
    const labels = (parseJson(labelsJson) ?? {}) as Record<string, string>
    if (!id || !(LABEL_DOCKERFILE_HASH in labels)) continue
    if ((labels[LABEL_OWNER] ?? OWNER_VALUE) !== OWNER_VALUE) continue
    if (!tags.every((t) => bareTag(t) === STOCK_IMAGE || bareTag(t).startsWith(`${STOCK_IMAGE}-`))) continue
    const labelled = labels[LABEL_DATA_DIR]
    const projectOf = (t: string): string | undefined => (bareTag(t).startsWith(`${STOCK_IMAGE}-`) ? bareTag(t).slice(STOCK_IMAGE.length + 1) : undefined)
    if (labelled) {
      if (!sameDataDir(labelled, dir)) continue
    } else if (tags.length === 0 || !tags.every((t) => bareTag(t) === STOCK_IMAGE || projectIds.has(projectOf(t) ?? ''))) continue
    const projectId = labels[LABEL_PROJECT] ?? tags.map(projectOf).find((p) => p && projectIds.has(p))
    things.push({ kind: 'image', name: tags.length ? tags.join(' ') : id, imageId: normaliseId(id), bytes: Number(size) || 0, ...(projectId ? { projectId } : {}) })
  }
  return things
}

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '') as unknown
  } catch {
    return null
  }
}

/** This install's cache volumes: labelled with this data folder, or unlabelled and named for one of its projects, and the legacy shared one. */
async function ownVolumes(run: CliRun, bin: string, dir: string, projectIds: ReadonlySet<string>, out: LeftoversOutcome): Promise<Thing[]> {
  const listed = await run(bin, ['volume', 'ls', '-q'], QUICK)
  if (listed.code !== 0) {
    out.failures.push(`listing ${bin}'s volumes: ${listed.stderr.trim().split('\n')[0] || `exit ${listed.code}`}`)
    return []
  }
  const names = lines(listed.stdout).filter((n) => n === LEGACY_CACHE_VOLUME || /^runcastle-proj_[A-Za-z0-9_-]+$/.test(n))
  if (!names.length) return []
  const inspected = await run(bin, ['volume', 'inspect', ...names], QUICK)
  const raw = inspected.code === 0 ? ((parseJson(inspected.stdout) as { Name?: string; Labels?: Record<string, string> | null }[] | null) ?? []) : []
  const sizes = await volumeSizes(run, bin)
  const things: Thing[] = []
  for (const name of names) {
    const labels = raw.find((v) => v.Name === name)?.Labels ?? {}
    const labelled = labels[LABEL_DATA_DIR]
    const projectId = labels[LABEL_PROJECT] ?? name.match(/^runcastle-(proj_[A-Za-z0-9_-]+)$/)?.[1]
    const mine = labelled ? sameDataDir(labelled, dir) : name === LEGACY_CACHE_VOLUME || (!!projectId && projectIds.has(projectId))
    if (!mine) continue
    const bytes = sizes.get(name)
    things.push({ kind: 'volume', name, ...(bytes !== undefined ? { bytes } : {}), ...(projectId ? { projectId } : {}) })
  }
  return things
}

/** Volume sizes from `system df -v`, best effort. */
async function volumeSizes(run: CliRun, bin: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  const df = await run(bin, ['system', 'df', '-v', '--format', '{{json .}}'], SLOW)
  if (df.code !== 0) return sizes
  for (const line of lines(df.stdout)) {
    const parsed = parseJson(line) as { Volumes?: { Name?: string; VolumeName?: string; Size?: string | number }[] } | null
    for (const v of parsed?.Volumes ?? []) {
      const name = v.Name ?? v.VolumeName
      const size = typeof v.Size === 'number' ? v.Size : parseSize(v.Size)
      if (name && size !== undefined) sizes.set(name, size)
    }
  }
  return sizes
}

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

/** `"1.2GB"`, `"512 MiB"`, `"0B"` to bytes; undefined for what it cannot read. */
export function parseSize(text: string | undefined): number | undefined {
  const m = text?.trim().match(/^([\d.]+)\s*([kmgt]i?)?b$/i)
  if (!m) return undefined
  const mult = UNITS[`${(m[2] ?? '').toLowerCase()}b`]
  return mult === undefined ? undefined : Math.round(Number(m[1]) * mult)
}

/** Runcastle's own image builders of this install (Docker's buildx), named with a hash of its data folder; their build cache goes with them. */
async function ownBuilders(run: CliRun, dir: string): Promise<Thing[]> {
  const prefix = `${BUILDER_PREFIX}${createHash('sha256').update(dir).digest('hex').slice(0, 8)}-`
  let listed = await run('docker', ['buildx', 'ls', '--format', '{{.Name}}'], QUICK)
  let names: string[]
  if (listed.code === 0) names = lines(listed.stdout)
  else {
    // An older buildx has no --format: a builder's own line starts at the margin, its nodes are indented.
    listed = await run('docker', ['buildx', 'ls'], QUICK)
    if (listed.code !== 0) return []
    names = listed.stdout.split('\n').filter((l) => /^\S/.test(l)).map((l) => l.split(/\s+/)[0]?.replace(/\*$/, '') ?? '')
  }
  return [...new Set(names.filter((n) => n.startsWith(prefix)))].map((name) => ({ kind: 'builder' as const, name }))
}

/** The workers' project copies (one per worker, named for it) and the runtime folders under the data folder. */
async function ownFolders(dir: string): Promise<Thing[]> {
  const things: Thing[] = []
  const origins = join(dir, 'workers', 'origins')
  let entries: string[] = []
  try {
    entries = existsSync(origins) ? readdirSync(origins) : []
  } catch {
    // Unreadable: left alone.
  }
  for (const e of entries) {
    const path = join(origins, e)
    things.push({ kind: 'folder', name: path, workerId: e.replace(/\.git$/, ''), ...withBytes(await folderBytes(path)) })
  }
  const runtime = join(dir, 'workers', 'runtime')
  if (existsSync(runtime)) things.push({ kind: 'folder', name: runtime, ...withBytes(await folderBytes(runtime)) })
  return things
}

/** Remove a folder the step emptied; one that still holds anything stays. */
function removeIfEmpty(path: string): void {
  try {
    if (existsSync(path) && readdirSync(path).length === 0) rmSync(path, { recursive: true })
  } catch {
    // Best effort.
  }
}

function withBytes(bytes: number | undefined): { bytes?: number } {
  return bytes === undefined ? {} : { bytes }
}

/** The size of Docker's shared build cache, from `system df`; undefined when it cannot say. */
async function buildCacheBytes(run: CliRun): Promise<number | undefined> {
  const df = await run('docker', ['system', 'df', '--format', '{{json .}}'], SLOW)
  if (df.code !== 0) return undefined
  for (const line of lines(df.stdout)) {
    const row = parseJson(line) as { Type?: string; Size?: string } | null
    if (row?.Type === 'Build Cache') return parseSize(row.Size)
  }
  return undefined
}

// --- removing -------------------------------------------------------------------

/**
 * Copy a finished container worker's conversation file out to where host
 * workers keep theirs, unless one was kept already, and record its tokens.
 * Best effort: a file that cannot be found or copied never keeps the container.
 */
async function keepConversationOutOf(ctx: AppCtx, run: CliRun, bin: string, container: string, workerId: string): Promise<void> {
  const kept = keptConversationPath(workerId)
  if (existsSync(kept)) return
  const w = ctx.db.select().from(workers).all().find((r) => r.id === workerId)
  const conversationId = getSessionRow(ctx, workerId)?.ccSessionId
  if (!w || !conversationId || !/^[\w-]+$/.test(conversationId)) return
  const inside = w.runtime === 'codex' ? '/home/agent/.codex/sessions' : '/home/agent/.claude/projects'
  const tmp = mkdtempSync(join(tmpdir(), 'runcastle-conversation-'))
  try {
    const cp = await run(bin, ['cp', `${container}:${inside}`, tmp], SLOW)
    if (cp.code !== 0) return
    const wanted = (name: string): boolean => (w.runtime === 'codex' ? name.startsWith('rollout-') && name.endsWith(`-${conversationId}.jsonl`) : name === `${conversationId}.jsonl`)
    const found = findFile(tmp, wanted)
    if (!found) return
    mkdirSync(dirname(kept), { recursive: true })
    copyFileSync(found, kept)
    const usage = readTranscriptUsage(kept, w.runtime)
    if (usage) updateWorker(ctx, workerId, { tokens: usage.total })
  } catch {
    // Best effort.
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function findFile(root: string, wanted: (name: string) => boolean): string | undefined {
  const pending = [root]
  while (pending.length) {
    const folder = pending.pop() as string
    let entries
    try {
      entries = readdirSync(folder, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const path = join(folder, e.name)
      if (e.isDirectory()) pending.push(path)
      else if (wanted(e.name)) return path
    }
  }
  return undefined
}

/** The command that removes one thing, after the binary. */
function removeArgs(t: Thing): string[] {
  switch (t.kind) {
    case 'container':
      return ['rm', '-f', t.name]
    case 'image':
      return ['rmi', ...t.name.split(' ')]
    case 'volume':
      return ['volume', 'rm', t.name]
    case 'builder':
      return ['buildx', 'rm', t.name]
    case 'folder':
      return []
  }
}

async function removeThing(run: CliRun, bin: string, t: Thing): Promise<void> {
  if (t.kind === 'folder') {
    rmSync(t.name, { recursive: true, force: true })
    return
  }
  const res = await run(bin, removeArgs(t), SLOW)
  if (res.code !== 0 && !/no such/i.test(res.stderr)) throw new Error(res.stderr.trim().split('\n')[0] || `exit ${res.code}`)
}

function quoted(path: string): string {
  return `"${path}"`
}

/** The exact commands that remove what was kept, by name: grouped per kind, a folder each. */
function removeCommands(bin: string, things: Thing[], platform: NodeJS.Platform): string[] {
  const of = (kind: Thing['kind']): Thing[] => things.filter((t) => t.kind === kind)
  const commands: string[] = []
  const containers = of('container')
  if (containers.length) commands.push(`${bin} rm -f ${containers.map((t) => t.name).join(' ')}`)
  const images = of('image')
  if (images.length) commands.push(`${bin} rmi ${images.map((t) => t.name).join(' ')}`)
  const volumes = of('volume')
  if (volumes.length) commands.push(`${bin} volume rm ${volumes.map((t) => t.name).join(' ')}`)
  for (const b of of('builder')) commands.push(`docker buildx rm ${b.name}`)
  for (const f of of('folder')) commands.push(platform === 'win32' ? `Remove-Item -Recurse -Force ${quoted(f.name)}` : `rm -rf ${quoted(f.name)}`)
  return commands
}

// --- saying what happened -------------------------------------------------------

const KIND_WORDS: Record<Thing['kind'], [string, string]> = {
  container: ['container', 'containers'],
  image: ['image', 'images'],
  volume: ['cache volume', 'cache volumes'],
  builder: ['image builder', 'image builders'],
  folder: ['folder', 'folders'],
}

function listOf(things: Thing[]): string {
  const parts = (Object.keys(KIND_WORDS) as Thing['kind'][])
    .map((kind) => [kind, things.filter((t) => t.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing')
}

/** One log line and one project event saying what the step did, on the project most of it belonged to (else the oldest). */
function report(
  ctx: AppCtx,
  out: LeftoversOutcome,
  projectRows: { id: string }[],
  closedIds: ReadonlySet<string>,
  found: { removed: Thing[]; kept: Thing[]; unknown: number; buildCache?: number },
): void {
  const sentences: string[] = []
  if (out.closed.length) {
    const one = out.closed.length === 1
    sentences.push(`Closed ${out.closed.length} worker${one ? '' : 's'} still in a container, which runcastle no longer has, and told ${one ? 'its lead' : 'their leads'} where ${one ? 'its' : 'their'} commits are.`)
  }
  if (found.removed.length) {
    const size = found.unknown === 0 ? formatBytes(out.bytes) : out.bytes > 0 ? `at least ${formatBytes(out.bytes)}` : 'size unknown'
    sentences.push(`Runcastle no longer uses containers, so it removed what it made for them for workers that landed or were dropped: ${listOf(found.removed)} (${size} freed).`)
  }
  if (found.kept.length) {
    const removes = out.commands.filter((c) => c !== 'docker builder prune')
    sentences.push(
      `It kept what may still hold unfinished work: ${listOf(found.kept)}. Once nothing in ${found.kept.length === 1 ? 'it' : 'them'} is needed, ${removes.map((c) => `\`${c}\``).join('; ')} ${removes.length === 1 ? 'removes it' : 'remove them'}.`,
    )
  }
  if (found.buildCache !== undefined) {
    sentences.push(`Docker's shared build cache holds ${formatBytes(found.buildCache)}, other projects' builds included; \`docker builder prune\` clears it.`)
  }
  if (out.failures.length) sentences.push(`Could not remove or read: ${out.failures.join('; ')}.`)
  if (!sentences.length) return
  const message = sentences.join(' ')
  console.log(`container leftovers: ${message}`)
  const counts = new Map<string, number>()
  for (const t of [...found.removed, ...found.kept]) if (t.projectId) counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1)
  const closedRows = ctx.db.select().from(workers).all().filter((w) => closedIds.has(w.id))
  for (const w of closedRows) counts.set(w.projectId, (counts.get(w.projectId) ?? 0) + 1)
  const known = [...counts].filter(([id]) => projectRows.some((p) => p.id === id)).sort((a, b) => b[1] - a[1])
  const projectId = known[0]?.[0] ?? projectRows[0]?.id
  if (!projectId) return
  try {
    emitProject(ctx, projectId, {
      type: 'workers.leftovers_removed',
      message: message.slice(0, 4000),
      data: {
        bin: out.bin,
        closed: out.closed,
        removed: out.things,
        kept: out.kept,
        commands: out.commands,
        bytes: out.bytes,
        sizeUnknown: found.unknown,
        ...(found.buildCache !== undefined ? { buildCacheBytes: found.buildCache } : {}),
        failures: out.failures,
      },
    })
  } catch (err) {
    console.error('container leftovers: could not record the event', err)
  }
}
