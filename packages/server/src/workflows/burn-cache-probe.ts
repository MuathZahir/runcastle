import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Sandbox } from '@ai-hero/sandcastle'
import { createSandbox } from '@ai-hero/sandcastle'
import { RuncastleConfig, resolveSandboxImage } from '@runcastle/core'
import type { ExecFn, ExecOutcome } from '../doctor/doctor'
import { createSystemExec } from '../doctor/system-exec'
import {
  type BurnCacheEngine,
  burnCacheVolumeName,
  createSlotAllocator,
  ensureBurnCacheVolume,
  removeBurnCacheVolume,
  slotRepoPath,
} from './burn-cache'
import {
  type PackageManager,
  SANDBOX_WORKSPACE_PATH,
  SETUP_MARKER_FILE,
  type SetupMarker,
  buildBurnCacheMounts,
  buildSlotSetupCommand,
  buildSlotStamp,
  detectPackageManager,
  fmtSeconds,
  parseSetupMarker,
  readRepoToolchain,
  resolveSetupCommand,
  selectSandbox,
} from './ticket-burner'

/**
 * `bun run burn-cache:probe <repoPath>` — proof that the burn cache volume is
 * actually HIT, not merely mounted (decision 7).
 *
 * A cache that is mounted and never used is indistinguishable from no cache at
 * all by reading code, and no unit test can tell the two apart: pnpm hardlinks
 * only when the store shares a filesystem with `node_modules`, `.tsbuildinfo`
 * only helps when it survives at the same absolute path, and turbo only reports
 * `FULL TURBO` when its inputs hash the same. All of those are properties of a
 * real container on a real engine. So this drives the REAL burner path —
 * `ensureBurnCacheVolume` → slot claim → {@link buildSlotSetupCommand} →
 * install → the repo's own verify commands — through two consecutive
 * containers, and prints what each cache did between them.
 *
 * Everything that decides the VERDICT is pure, which is what makes it testable
 * without an engine: the containers produce measurements, and the measurements
 * alone decide the rows, the table and the exit code.
 */

/** The file a probed repo names its verify commands in, at the repo root. */
export const PROBE_CONFIG_FILE = 'runcastle.probe.json'

/**
 * The verify commands the probe times, in the order it runs them. They are read
 * from the repo rather than guessed because the probe has to know WHICH command
 * is the typecheck (so a `.tsbuildinfo` row means something) and which is the
 * test run.
 *
 * Name the tool, not a package script: `pnpm exec vitest run`, not `pnpm test`.
 * {@link expectedCaches} reads these strings to decide which caches this repo
 * can even have, and `npm test` hides that it is jest.
 */
export const PROBE_COMMAND_KEYS = ['typecheck', 'test', 'build'] as const
export type ProbeCommandKey = (typeof PROBE_COMMAND_KEYS)[number]

export interface ProbeCommands {
  typecheck: string
  test: string
  build?: string
}

/** A probe that cannot proceed — bad usage, missing engine, failed command. */
export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

/** Read and validate a repo's `runcastle.probe.json`. */
export function parseProbeCommands(json: string): ProbeCommands {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ProbeError(`${PROBE_CONFIG_FILE} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProbeError(`${PROBE_CONFIG_FILE} must be an object`)
  }
  const record = parsed as Record<string, unknown>
  for (const key of ['typecheck', 'test'] as const) {
    if (typeof record[key] !== 'string' || record[key].trim().length === 0) {
      throw new ProbeError(`${PROBE_CONFIG_FILE} needs a non-empty "${key}" command`)
    }
  }
  const build = record.build
  return {
    typecheck: record.typecheck as string,
    test: record.test as string,
    ...(typeof build === 'string' && build.trim().length > 0 ? { build } : {}),
  }
}

// ---------------------------------------------------------------------------
// Pure unit — which caches this repo can even have
// ---------------------------------------------------------------------------

export type ProbeCache =
  | 'install'
  | 'tsbuildinfo'
  | 'vitest'
  | 'jest'
  | 'turbo'
  | 'store-hardlinks'

/** Display order of the table's rows. */
const CACHE_ORDER: readonly ProbeCache[] = [
  'install',
  'tsbuildinfo',
  'vitest',
  'jest',
  'turbo',
  'store-hardlinks',
]

/**
 * The caches this repo is expected to hit, read off its package manager and the
 * tools its verify commands name. A repo with no jest gets no jest row — an
 * unmet expectation is a failure, so expecting a cache the repo cannot produce
 * would make the probe fail on a healthy volume.
 *
 * Hardlinks are asserted for pnpm and bun only: those two link out of their
 * store, while npm and yarn extract tarballs and never link, so a link count of
 * 1 says nothing about them.
 */
export function expectedCaches(
  pm: PackageManager | undefined,
  commands: ProbeCommands,
): ProbeCache[] {
  const text = PROBE_COMMAND_KEYS.map((key) => commands[key] ?? '').join(' ')
  const present: Record<ProbeCache, boolean> = {
    install: pm !== undefined,
    tsbuildinfo: /\btsc\b/.test(text) && /\s(?:-b|--build)(?:\s|$)/.test(text),
    vitest: /\bvitest\b/.test(text),
    jest: /\bjest\b/.test(text),
    turbo: /\bturbo\b/.test(text),
    'store-hardlinks': pm === 'pnpm' || pm === 'bun',
  }
  return CACHE_ORDER.filter((cache) => present[cache])
}

// ---------------------------------------------------------------------------
// Pure unit — what one container observes, and how it is measured
// ---------------------------------------------------------------------------

/** Cache state at one moment inside a container, all of it counted in files. */
export interface CacheSnapshot {
  /** `*.tsbuildinfo` files in the checkout, outside `node_modules`. */
  tsbuildinfo: number
  /** vitest `results.json` files under `node_modules/.vite/vitest`. */
  vitest: number
  /** Files in jest's cache directory under `$TMPDIR`. */
  jest: number
  /** Files in `.turbo/cache`. */
  turbo: number
  /** Hard-link count of one file linked out of the package manager's store. */
  storeLinks: number
}

const SNAPSHOT_KEYS = ['tsbuildinfo', 'vitest', 'jest', 'turbo', 'storeLinks'] as const

/**
 * The in-container shell that counts every cache in one round trip, printing
 * `key=value` lines for {@link parseSnapshot}.
 *
 * Deliberately a count of files rather than a `test -d`: a cache DIRECTORY is
 * created by the tool whether or not it ever wrote anything, so "the directory
 * exists" is exactly the false positive this whole script exists to rule out.
 *
 * The vitest path is globbed, not hard-coded: vitest 3 writes
 * `node_modules/.vite/vitest/<hash>/results.json`, one hash directory per
 * project root, and the hash is not something the host can compute.
 */
export function buildSnapshotCommand(repoPath: string, pm: PackageManager | undefined): string {
  const count = (key: string, find: string): string =>
    `echo "${key}=$(${find} -type f 2>/dev/null | wc -l)"`
  const links = (dir: string): string =>
    `echo "storeLinks=$(find ${dir} -type f 2>/dev/null | head -n 1 | xargs -r stat -c %h 2>/dev/null || echo 0)"`
  return [
    count('tsbuildinfo', `find ${repoPath} -name '*.tsbuildinfo' -not -path '*/node_modules/*'`),
    count('vitest', `find ${repoPath}/node_modules/.vite/vitest -name results.json`),
    // jest derives its cache dir from `os.tmpdir()`, which follows TMPDIR — the
    // burn cache env points that at the volume (decision 10). The exact leaf
    // name is a base-36 uid (`jest_rs`), so it is globbed.
    count('jest', `find "\${TMPDIR:-/tmp}"/jest*`),
    count('turbo', `find ${repoPath}/.turbo/cache`),
    pm === 'pnpm'
      ? links(`${repoPath}/node_modules/.pnpm`)
      : pm === 'bun'
        ? links(`"\${BUN_INSTALL_CACHE_DIR:-$HOME/.bun/install/cache}"`)
        : `echo "storeLinks=0"`,
  ].join('; ')
}

/** Fold {@link buildSnapshotCommand}'s output back into a snapshot; absent = 0. */
export function parseSnapshot(stdout: string): CacheSnapshot {
  const snapshot: CacheSnapshot = { tsbuildinfo: 0, vitest: 0, jest: 0, turbo: 0, storeLinks: 0 }
  for (const line of stdout.split('\n')) {
    const [key, value] = line.trim().split('=')
    const known = SNAPSHOT_KEYS.find((candidate) => candidate === key)
    if (!known) continue
    const parsed = Number(value)
    snapshot[known] = Number.isFinite(parsed) ? parsed : 0
  }
  return snapshot
}

/** One verify command's cost and output inside one container. */
export interface CommandRun {
  command: string
  durationMs: number
  exitCode: number
  /** stdout and stderr together — turbo reports its cache verdict on both. */
  output: string
}

/** Everything one of the two containers produced. */
export interface ProbeRun {
  /** The slot was cloned or wiped this iteration — its caches started empty. */
  cold: boolean
  syncMs: number
  installMs: number
  /** Cache state after setup, BEFORE any verify command ran. */
  before: CacheSnapshot
  /** Cache state after every verify command ran. */
  after: CacheSnapshot
  commands: Partial<Record<ProbeCommandKey, CommandRun>>
}

// ---------------------------------------------------------------------------
// Pure unit — the table and its verdict
// ---------------------------------------------------------------------------

/** One line of the probe's report: what the cache did cold, warm, and whether it hit. */
export interface CacheRow {
  cache: ProbeCache
  cold: string
  warm: string
  hit: boolean
}

/** `turbo` announces a restored task on stdout; both spellings count. */
function turboReportedHit(run: ProbeRun): boolean {
  return Object.values(run.commands).some(
    (command) => /\bturbo\b/.test(command.command) && /cache hit|FULL TURBO/i.test(command.output),
  )
}

function durationOf(run: ProbeRun, key: ProbeCommandKey): number {
  return run.commands[key]?.durationMs ?? 0
}

/** The install cell reads the same on both sides — the hook's own timing. */
const installCell = (run: ProbeRun): string =>
  `${fmtSeconds(run.installMs)}${run.cold ? ' (cold slot)' : ''}`

/**
 * How each cache reads cold, reads warm, and what counts as a hit. Table-driven
 * so a new cache is one entry rather than another branch in three places.
 *
 * The warm cell reads the BEFORE snapshot wherever a tool's own cache is at
 * stake: what matters is that the cache survived the container rebuild and was
 * there when the tool started, not that the tool recreated it afterwards —
 * which it would do even with no volume at all. Durations corroborate; the
 * survival is the claim.
 */
const CACHE_ROWS: Record<
  ProbeCache,
  {
    cold: (run: ProbeRun) => string
    warm: (run: ProbeRun) => string
    hit: (cold: ProbeRun, warm: ProbeRun) => boolean
  }
> = {
  install: {
    cold: installCell,
    warm: installCell,
    hit: (cold, warm) => !warm.cold && warm.installMs < cold.installMs,
  },
  tsbuildinfo: {
    cold: (run) => `${run.after.tsbuildinfo} file(s), typecheck ${fmtSeconds(durationOf(run, 'typecheck'))}`,
    warm: (run) => `${run.before.tsbuildinfo} file(s), typecheck ${fmtSeconds(durationOf(run, 'typecheck'))}`,
    hit: (cold, warm) =>
      cold.after.tsbuildinfo > 0 &&
      warm.before.tsbuildinfo > 0 &&
      durationOf(warm, 'typecheck') < durationOf(cold, 'typecheck'),
  },
  vitest: {
    cold: (run) => `${run.after.vitest} results.json`,
    warm: (run) => `${run.before.vitest} results.json`,
    hit: (cold, warm) => cold.after.vitest > 0 && warm.before.vitest > 0,
  },
  jest: {
    cold: (run) => `${run.after.jest} file(s), test ${fmtSeconds(durationOf(run, 'test'))}`,
    warm: (run) => `${run.before.jest} file(s), test ${fmtSeconds(durationOf(run, 'test'))}`,
    hit: (cold, warm) =>
      cold.after.jest > 0 &&
      warm.before.jest > 0 &&
      durationOf(warm, 'test') < durationOf(cold, 'test'),
  },
  turbo: {
    cold: (run) => `${run.after.turbo} file(s)`,
    warm: (run) => `${run.before.turbo} file(s), ${turboReportedHit(run) ? 'cache hit' : 'no cache hit'}`,
    hit: (cold, warm) => cold.after.turbo > 0 && turboReportedHit(warm),
  },
  'store-hardlinks': {
    cold: (run) => `${run.after.storeLinks} link(s)`,
    warm: (run) => `${run.after.storeLinks} link(s)`,
    hit: (cold) => cold.after.storeLinks > 1,
  },
}

/** The report: one row per expected cache, in {@link CACHE_ORDER}. */
export function buildCacheRows(
  caches: readonly ProbeCache[],
  cold: ProbeRun,
  warm: ProbeRun,
): CacheRow[] {
  return CACHE_ORDER.filter((cache) => caches.includes(cache)).map((cache) => {
    const spec = CACHE_ROWS[cache]
    return { cache, cold: spec.cold(cold), warm: spec.warm(warm), hit: spec.hit(cold, warm) }
  })
}

/** `0` when every expected cache hit, `1` when any did not (decision 7). */
export function probeExitCode(rows: readonly CacheRow[]): number {
  return rows.some((row) => !row.hit) ? 1 : 0
}

const TABLE_HEADERS = ['cache', 'cold', 'warm', 'hit'] as const

/** The `cache | cold | warm | hit` table, column-aligned. */
export function formatCacheTable(rows: readonly CacheRow[]): string {
  const cells = [
    [...TABLE_HEADERS],
    ...rows.map((row) => [row.cache, row.cold, row.warm, row.hit ? 'yes' : 'MISS']),
  ]
  const widths = TABLE_HEADERS.map((_, column) =>
    Math.max(...cells.map((row) => (row[column] ?? '').length)),
  )
  const line = (row: string[]): string =>
    row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ')
  const [header, ...body] = cells.map(line)
  return [header, widths.map((width) => '-'.repeat(width)).join('  '), ...body].join('\n')
}

// ---------------------------------------------------------------------------
// Pure unit — preflight (an engine and an image, before anything expensive)
// ---------------------------------------------------------------------------

/** What the three preflight commands answered. */
export interface PreflightProbes {
  /** `<engine> --version` — is the CLI there at all. */
  cli: ExecOutcome
  /** `<engine> info` — is the daemon/machine actually up. */
  info: ExecOutcome
  /** `<engine> image inspect <image>` — is the sandbox image built. */
  image: ExecOutcome
}

const ok = (outcome: ExecOutcome): boolean => outcome.ok && outcome.code === 0

/**
 * The reason the probe cannot run, with a fix line, or `undefined` when it can.
 * Same shape as the doctor's verdicts (`packages/server/src/doctor/doctor.ts`):
 * a precise detail and one command or click that resolves it. Engine-specific,
 * where the doctor's probes take whichever runtime is present first — `--engine
 * podman` on a host that also has docker must be told about PODMAN.
 */
export function preflightFailure(
  engine: BurnCacheEngine,
  image: string,
  probes: PreflightProbes,
): string | undefined {
  if (!ok(probes.cli)) {
    return `${engine} was not found on PATH.\nFix: install Docker Desktop or Podman (see docs/research/PREREQS-NOTES.md §4), or re-run with --engine <the one you have>.`
  }
  if (!ok(probes.info)) {
    return engine === 'docker'
      ? 'docker CLI is installed but the daemon is not responding.\nFix: start Docker Desktop (or `sudo systemctl start docker` on Linux), then re-run.'
      : 'podman CLI is installed but its machine is not initialized/started.\nFix: run `podman machine init && podman machine start`, then re-run.'
  }
  if (!ok(probes.image)) {
    return `image ${image} not found locally.\nFix: start runcastle and click "Build image" on the Enable AFK burns card — it builds this for you (one click).`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Pure unit — the command line
// ---------------------------------------------------------------------------

export interface ProbeArgs {
  repoPath: string
  engine: BurnCacheEngine
  /** Leave the probe volume behind, so a second run starts warm. */
  keep: boolean
}

export const PROBE_USAGE =
  'usage: bun run burn-cache:probe <repoPath> [--engine docker|podman] [--keep]'

export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  let repoPath: string | undefined
  let engine: BurnCacheEngine = 'docker'
  let keep = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--keep') keep = true
    else if (arg === '--engine') {
      const value = argv[++i]
      if (value !== 'docker' && value !== 'podman') {
        throw new ProbeError(`--engine must be docker or podman\n${PROBE_USAGE}`)
      }
      engine = value
    } else if (arg.startsWith('-')) throw new ProbeError(`unknown flag ${arg}\n${PROBE_USAGE}`)
    else if (repoPath === undefined) repoPath = arg
    else throw new ProbeError(`unexpected argument ${arg}\n${PROBE_USAGE}`)
  }
  if (repoPath === undefined) throw new ProbeError(`missing <repoPath>\n${PROBE_USAGE}`)
  return { repoPath, engine, keep }
}

/**
 * The project id the probe's volume is named after — `runcastle-probe-<hash>`
 * once {@link burnCacheVolumeName} has had it. Derived from the repo path so
 * repeated probes of one repo reuse their warm volume under `--keep`, and
 * NEVER equal to a real `proj_…` id, so the probe cannot clear a project's
 * cache by running against its repo.
 */
export function probeProjectId(repoPath: string): string {
  return `probe-${createHash('sha256').update(repoPath).digest('hex').slice(0, 12)}`
}

// ---------------------------------------------------------------------------
// The container run
// ---------------------------------------------------------------------------

/** Directories never copied into the scratch repo — build output and installs. */
const SCRATCH_SKIP = new Set(['.git', 'node_modules', 'dist', '.turbo', '.out'])

/**
 * Sandcastle's hook timeout matters only if it starts enforcing one; a cold
 * monorepo install blows past its 60s default, and this hook does the install.
 */
const PROBE_SETUP_TIMEOUT_MS = 15 * 60_000

export interface BurnCacheProbeOptions {
  repoPath: string
  engine: BurnCacheEngine
  keep: boolean
  /** Host command runner — injected so a test can watch the engine argv. */
  exec?: ExecFn
  log?: (line: string) => void
}

export interface BurnCacheProbeResult {
  rows: CacheRow[]
  exitCode: number
}

/**
 * Two consecutive burn-style containers on one slot of a probe-only volume, and
 * the table of what the caches did between them.
 *
 * Every step is the burner's own: `ensureBurnCacheVolume`, a claimed slot,
 * `buildSlotSetupCommand` as the `onSandboxReady` hook, `buildBurnCacheMounts`
 * + `selectSandbox` for the mount and env. What differs is only that no agent
 * runs — `createSandbox` starts the container and the probe drives the repo's
 * verify commands itself, which is the whole point: the measurement is of the
 * caches, with no agent variance on top.
 */
export async function runBurnCacheProbe(
  opts: BurnCacheProbeOptions,
): Promise<BurnCacheProbeResult> {
  const exec = opts.exec ?? createSystemExec()
  const log = opts.log ?? ((): void => {})
  const config = RuncastleConfig.parse({ sandbox: opts.engine })
  const imageName = resolveSandboxImage(config)

  const failure = preflightFailure(opts.engine, imageName, {
    cli: await exec(opts.engine, ['--version']),
    info: await exec(opts.engine, ['info']),
    image: await exec(opts.engine, ['image', 'inspect', imageName]),
  })
  if (failure) throw new ProbeError(failure)

  const projectId = probeProjectId(opts.repoPath)
  const volume = burnCacheVolumeName(projectId)
  const scratch = await createProbeScratchRepo(opts.repoPath, exec)
  log(`probe repo: ${scratch}`)
  log(`probe volume: ${volume}${opts.keep ? ' (kept)' : ''}`)
  // Width 1, and the probe's OWN allocator rather than the process-wide one:
  // the two runs are sequential by design (run 2 is warm only because run 1
  // left the slot behind), and resizing the shared allocator to 1 would be a
  // trap the day anything imports this into the server.
  const allocator = createSlotAllocator(1)
  try {
    const commands = parseProbeCommands(readProbeConfig(scratch))
    const toolchain = readRepoToolchain(scratch)
    const pm = detectPackageManager(toolchain)
    const setupCommand = resolveSetupCommand(toolchain)
    const stamp = buildSlotStamp(imageName, toolchain.packageManagerField)

    await ensureBurnCacheVolume({ engine: opts.engine, imageName, projectId, exec })
    const slot = allocator.claim()
    const container = (attempt: number): Promise<ProbeRun> => {
      log(`run ${attempt}/2 — starting container`)
      return probeOneContainer({
        attempt,
        slot,
        config,
        projectId,
        scratch,
        pm,
        setupCommand,
        stamp,
        commands,
        log,
      })
    }
    let rows: CacheRow[]
    try {
      const cold = await container(1)
      const warm = await container(2)
      rows = buildCacheRows(expectedCaches(pm, commands), cold, warm)
    } finally {
      allocator.release(slot)
    }
    return { rows, exitCode: probeExitCode(rows) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    // On EVERY exit path, not just success: a failed probe that left a volume
    // behind would silently make the next probe's "cold" run warm.
    if (!opts.keep) {
      const removal = await removeBurnCacheVolume({
        engine: opts.engine,
        projectId,
        exec,
        slots: allocator.held(),
      }).catch((err: unknown) => err)
      if (removal) log(`could not remove ${volume}: ${String(removal)}`)
    }
  }
}

function readProbeConfig(repoPath: string): string {
  try {
    return readFileSync(join(repoPath, PROBE_CONFIG_FILE), 'utf8')
  } catch {
    throw new ProbeError(
      `${repoPath} has no ${PROBE_CONFIG_FILE} — add one naming this repo's typecheck and test commands, e.g. {"typecheck":"pnpm exec tsc -b","test":"pnpm exec vitest run"}`,
    )
  }
}

/**
 * A throwaway git repo holding a copy of the target, because the burn path
 * needs a branch to fork a worktree from and the target may be a fixture
 * directory that is not a repo at all (or, as with runcastle's own fixtures,
 * a subdirectory of an unrelated one). Build output and installs are left
 * behind so the copy is small and run 1 is genuinely cold.
 */
export async function createProbeScratchRepo(repoPath: string, exec: ExecFn): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), 'runcastle-probe-'))
  cpSync(repoPath, scratch, {
    recursive: true,
    // The root itself is never skipped — probing a directory that happens to be
    // called `dist` must still copy it.
    filter: (source) => source === repoPath || !SCRATCH_SKIP.has(basename(source)),
  })
  const git = async (...args: string[]): Promise<void> => {
    const out = await exec('git', ['-C', scratch, ...args])
    if (!out.ok || out.code !== 0) {
      throw new ProbeError(`git ${args.join(' ')} failed in the probe repo: ${out.stderr.trim()}`)
    }
  }
  await git('init', '-b', 'main')
  await git('add', '-A')
  await git(
    '-c',
    'user.email=probe@runcastle.invalid',
    '-c',
    'user.name=runcastle probe',
    'commit',
    '-q',
    '-m',
    'probe baseline',
  )
  return scratch
}

interface ProbeContainerOptions {
  attempt: number
  slot: number
  config: RuncastleConfig
  projectId: string
  scratch: string
  pm: PackageManager | undefined
  setupCommand: string | undefined
  stamp: string
  commands: ProbeCommands
  log: (line: string) => void
}

/** One container: sync the slot, install, snapshot, run the verify commands, snapshot. */
async function probeOneContainer(opts: ProbeContainerOptions): Promise<ProbeRun> {
  // A fresh branch per run, exactly as consecutive burn attempts get: it is the
  // slot that carries the caches across, never the branch.
  const branch = `runcastle/probe/run${opts.attempt}`
  const repo = slotRepoPath(opts.slot)
  const cache = buildBurnCacheMounts(opts.slot, opts.projectId, opts.config.sandbox, opts.pm)
  const sandbox = await createSandbox({
    branch,
    sandbox: selectSandbox(opts.config, cache.mounts, cache.env),
    cwd: opts.scratch,
    hooks: {
      sandbox: {
        onSandboxReady: [
          {
            command: buildSlotSetupCommand(
              opts.slot,
              branch,
              opts.setupCommand,
              opts.pm,
              opts.stamp,
            ),
            timeoutMs: PROBE_SETUP_TIMEOUT_MS,
          },
        ],
      },
    },
  })
  try {
    const marker = await readSetupMarker(sandbox)
    opts.log(
      `run ${opts.attempt}/2 — slot ${opts.slot} ${marker.cold ? 'cold' : 'warm'}, synced in ${fmtSeconds(marker.syncMs)}, installed in ${fmtSeconds(marker.installMs)}`,
    )
    const snapshot = async (): Promise<CacheSnapshot> =>
      parseSnapshot((await sandbox.exec(buildSnapshotCommand(repo, opts.pm))).stdout)
    const before = await snapshot()
    const commands: Partial<Record<ProbeCommandKey, CommandRun>> = {}
    for (const key of PROBE_COMMAND_KEYS) {
      const command = opts.commands[key]
      if (!command) continue
      const startedAt = Date.now()
      const result = await sandbox.exec(command, { cwd: repo })
      const run: CommandRun = {
        command,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        output: `${result.stdout}\n${result.stderr}`,
      }
      if (run.exitCode !== 0) {
        throw new ProbeError(
          `run ${opts.attempt}: \`${command}\` failed with exit ${run.exitCode}:\n${run.output.trim().slice(-2000)}`,
        )
      }
      opts.log(`run ${opts.attempt}/2 — ${key}: ${fmtSeconds(run.durationMs)}`)
      commands[key] = run
    }
    return {
      cold: marker.cold,
      syncMs: marker.syncMs,
      installMs: marker.installMs,
      before,
      after: await snapshot(),
      commands,
    }
  } finally {
    await sandbox.close()
  }
}

/**
 * The setup hook's own timing line. Sandcastle discards a sandbox hook's
 * stdout, so {@link buildSlotSetupCommand} leaves it in the mounted workspace
 * instead; read it from inside the container and delete it, so the worktree is
 * not dirty when sandcastle tears it down.
 */
async function readSetupMarker(sandbox: Sandbox): Promise<SetupMarker> {
  const file = `${SANDBOX_WORKSPACE_PATH}/${SETUP_MARKER_FILE}`
  const result = await sandbox.exec(`cat ${file} 2>/dev/null; rm -f ${file}`)
  const marker = parseSetupMarker(result.stdout)
  if (!marker) {
    throw new ProbeError(
      'the slot setup hook left no timing marker — it did not complete, so nothing can be measured',
    )
  }
  return marker
}
