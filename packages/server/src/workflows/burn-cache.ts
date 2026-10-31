import type { ExecFn } from '../doctor/doctor'
import { type BurnUser, burnUserSpec, resolveBurnUser } from './burn-user'
import type { PackageManager } from './ticket-burner'

/**
 * The persistent burn cache: one Docker/Podman named volume per project, and
 * the in-memory allocator that hands its slots out to concurrent burns.
 *
 * Every burn starts stone cold today — the container is rebuilt per iteration
 * (ADR-0008), the repo is cloned fresh, the install runs for minutes, and the
 * agent's first typecheck and first test run pay full price because
 * `.tsbuildinfo`, the test runner's cache and turbo's cache all died with the
 * previous container. ADR-0004 tried bind-mounting the pnpm store and measured
 * it as SLOWER (pnpm cannot hardlink across a bind mount) and named the
 * mechanism that does work: a named volume, which shares a filesystem with the
 * checkouts on it.
 *
 * So the volume holds whole working folders rather than four redirected caches
 * (decision 2): `slots/<n>/repo` is a persistent checkout per burn-concurrency
 * slot, and `store/<pm>` is the one cache that genuinely is shared between
 * concurrent containers. A ticket claims a slot before its first iteration and
 * holds it until it exits, which is what turns a per-iteration re-install into
 * a seconds-long re-sync.
 *
 * This module is the host side of that: volume lifecycle (create, chown, size,
 * remove) and slot ownership. Every command goes through an injected
 * {@link ExecFn} so the exact argv is observable without a container engine.
 * Nothing here reads config or touches the burner — see the ticket-burner for
 * where a slot is claimed and synced.
 */

/** The container engines whose `-v` flag understands a named volume. */
export type BurnCacheEngine = 'docker' | 'podman'

/** Where the cache volume is mounted inside every burn container. */
export const BURN_CACHE_MOUNT = '/home/agent/cache'

/**
 * The named volume backing one project's burn cache. Project ids are
 * `proj_<nanoid12>`, which is already a legal Docker/Podman volume name
 * (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`), so no sanitising is needed — and none is
 * wanted, because two projects must never collide on one volume.
 */
export function burnCacheVolumeName(projectId: string): string {
  return `runcastle-${projectId}`
}

/**
 * The persistent checkout for slot `n`. This is a CONTAINER path and the same
 * one on every run, which is the whole point: `.tsbuildinfo`, jest's
 * `rootDir`-keyed cache and Node's compile cache are all keyed to a stable
 * absolute path and are worthless if it moves. It replaces
 * `ISOLATED_REPO_PATH` as the agent's hot path when the cache is on.
 */
export function slotRepoPath(slot: number): string {
  return `${slotDirPath(slot)}/repo`
}

/** Slot `n`'s own directory on the volume — the checkout plus its stamp. */
export function slotDirPath(slot: number): string {
  return `${BURN_CACHE_MOUNT}/slots/${slot}`
}

/**
 * The toolchain stamp slot `n` was last used with (decision 5). Deliberately
 * BESIDE the checkout rather than inside it: the sync step runs `git clean` in
 * the checkout, and a stamp that a clean could delete would read as a mismatch
 * on every burn and wipe the warm state it exists to protect.
 */
export function slotStampPath(slot: number): string {
  return `${slotDirPath(slot)}/.runcastle-stamp`
}

/**
 * The package manager's store/cache directory on the volume. One directory per
 * manager rather than one shared: pnpm's is a content-addressed store, npm's
 * and yarn's are tarball caches and bun's is its own format, and mixing them in
 * one directory is how you get a manager rejecting the lot.
 */
export function storePath(pm: PackageManager): string {
  return `${BURN_CACHE_MOUNT}/store/${pm}`
}

const BURN_CACHE_TMP_PATH = `${BURN_CACHE_MOUNT}/tmp`
const BURN_CACHE_NODE_COMPILE_PATH = `${BURN_CACHE_MOUNT}/node-compile`

/** Directories the sandbox must create before using {@link burnCacheEnv}. */
export function burnCacheDirectories(pm?: PackageManager): string[] {
  return pm
    ? [BURN_CACHE_TMP_PATH, BURN_CACHE_NODE_COMPILE_PATH, storePath(pm)]
    : [BURN_CACHE_TMP_PATH, BURN_CACHE_NODE_COMPILE_PATH]
}

/**
 * The environment every burn container gets when the cache is on, pointing each
 * package manager's store and Node's own caches at the volume (spec §Approach).
 *
 * All of it is set for every manager, not just the detected one: the variables
 * are namespaced per tool and an unused one costs nothing, while a per-manager
 * switch would silently miss a repo that shells out to a second manager.
 * `TMPDIR` is on the volume because jest's default `cacheDirectory` is derived
 * from it, and `NODE_COMPILE_CACHE` because Node's compile cache is worth
 * keeping across a container rebuild too.
 */
export function burnCacheEnv(pm: PackageManager): Record<string, string> {
  const store = storePath(pm)
  return {
    npm_config_store_dir: store,
    pnpm_config_store_dir: store,
    BUN_INSTALL_CACHE_DIR: store,
    npm_config_cache: store,
    YARN_GLOBAL_FOLDER: store,
    TMPDIR: BURN_CACHE_TMP_PATH,
    NODE_COMPILE_CACHE: BURN_CACHE_NODE_COMPILE_PATH,
  }
}

// ---------------------------------------------------------------------------
// Volume lifecycle (host side)
// ---------------------------------------------------------------------------

/** Refusal to drop a cache volume that burns are still working out of. */
export class BurnCacheBusyError extends Error {
  /** The slot numbers held when the clear was attempted. */
  readonly slots: readonly number[]
  constructor(slots: readonly number[]) {
    super(`burn cache is in use — slots ${slots.join(', ')} are held; stop those burns before clearing it`)
    this.name = 'BurnCacheBusyError'
    this.slots = slots
  }
}

/**
 * Left on the volume when it is created, so the volume is never empty. Docker
 * copies an image's directory, owner included, onto an EMPTY volume mounted over
 * it, so a project image with a root-owned `~/.m2` would otherwise reset a
 * freshly chowned volume to `0:0` on its first mount. Measured on a real engine:
 * the owner goes to `0:0` without this file and stays put with it.
 */
export const BURN_CACHE_MARKER_FILE = '.runcastle-volume'

/**
 * Run one engine command, throwing its stderr on failure. Volume setup has no
 * sensible degraded mode — a burn that silently proceeds without its cache
 * would look like nothing more than a slow burn.
 */
async function execOrThrow(exec: ExecFn, engine: BurnCacheEngine, args: string[]): Promise<void> {
  const out = await exec(engine, args)
  if (!out.ok || out.code !== 0) {
    throw new Error(`${engine} ${args.join(' ')} failed: ${out.stderr.trim() || `exit ${out.code}`}`)
  }
}

export interface EnsureBurnCacheVolumeOptions {
  engine: BurnCacheEngine
  /** The sandbox image — the chown one-shot runs it, so no second image is pulled. */
  imageName: string
  projectId: string
  exec: ExecFn
  /** Who burns run as; resolved from the host when omitted. */
  burnUser?: BurnUser
  /** Told when a volume the burn user cannot write to is about to be replaced. */
  onRepair?: (found: Extract<BurnCacheAccess, { state: 'unwritable' }>) => void
}

/**
 * The label stamped on every cache volume runcastle creates, and the version of
 * the volume layout it vouches for. It says nothing about who owns the volume:
 * `volume create` stamps it BEFORE the chown, so a server killed between the two
 * leaves a labelled, root-owned volume. {@link checkBurnCacheAccess} answers that.
 *
 * Bump the version if the on-volume layout ever changes incompatibly: a volume
 * carrying an older (or no) version is dropped and recreated rather than trusted.
 * Unlabelled volumes exist in the wild: v1.2.11 created the volume, then failed
 * its chown (the one-shot ran through the image's `sleep` ENTRYPOINT), and left
 * a root-owned, empty volume behind that every later burn "found" and skipped.
 */
export const BURN_CACHE_VOLUME_LABEL = 'io.runcastle.burn-cache'
export const BURN_CACHE_VOLUME_VERSION = '1'

/** What `volume inspect` says about the project's cache volume. */
export type BurnCacheVolumeState = 'missing' | 'current' | 'stale'

/**
 * Inspect the project's cache volume: absent, created by this version of the
 * code (label matches), or `stale` — present but without a matching label, so
 * nothing is known about its ownership and it must not be burned against.
 * An inspect that fails for any reason other than "no such volume" is treated
 * as missing and left for `volume create` to report properly.
 */
export async function inspectBurnCacheVolume(
  exec: ExecFn,
  engine: BurnCacheEngine,
  projectId: string,
): Promise<BurnCacheVolumeState> {
  const out = await exec(engine, [
    'volume',
    'inspect',
    '--format',
    `{{index .Labels "${BURN_CACHE_VOLUME_LABEL}"}}`,
    burnCacheVolumeName(projectId),
  ])
  if (!out.ok || out.code !== 0) return 'missing'
  return out.stdout.trim() === BURN_CACHE_VOLUME_VERSION ? 'current' : 'stale'
}

/** What {@link checkBurnCacheAccess} found. */
export type BurnCacheAccess =
  | { state: 'writable' }
  /** The burn user cannot write to `path`, which `owner` (`uid:gid`) holds. */
  | { state: 'unwritable'; path: string; owner: string }
  /** No clear answer. Never a reason to touch the volume. */
  | { state: 'unknown'; reason: string }

export interface CheckBurnCacheAccessOptions {
  engine: BurnCacheEngine
  imageName: string
  projectId: string
  exec: ExecFn
  burnUser: BurnUser
}

/** Marks the check's own output line, so stray image output is never parsed. */
const ACCESS_SENTINEL = 'runcastle-access'

/**
 * Tests the mount point and the folders directly inside it, which is the depth
 * a non-recursive hand-fix or a UID change leaves wrong. The whole tree would
 * cost a scan of a multi-gigabyte cache on every run.
 */
const ACCESS_SCRIPT = `for p in "$1" "$1"/*; do [ -d "$p" ] || continue; [ -w "$p" ] || { echo "${ACCESS_SENTINEL} unwritable $(stat -c %u:%g "$p") $p"; exit 0; }; done; echo "${ACCESS_SENTINEL} writable"`

/**
 * Ask the volume whether the burn user can write to it, from a one-shot
 * container running AS that user (decision 3). Asking rather than comparing
 * owner numbers is what makes the answer true under any id mapping, and it is
 * the question a burn actually needs answered.
 */
export async function checkBurnCacheAccess(
  opts: CheckBurnCacheAccessOptions,
): Promise<BurnCacheAccess> {
  const out = await opts.exec(opts.engine, [
    'run',
    '--rm',
    '--user',
    burnUserSpec(opts.burnUser),
    '--entrypoint',
    'sh',
    '-v',
    `${burnCacheVolumeName(opts.projectId)}:${BURN_CACHE_MOUNT}`,
    opts.imageName,
    '-c',
    ACCESS_SCRIPT,
    'sh',
    BURN_CACHE_MOUNT,
  ])
  if (!out.ok || out.code !== 0) {
    return { state: 'unknown', reason: out.stderr.trim() || `exit ${out.code ?? 'unknown'}` }
  }
  const line = out.stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${ACCESS_SENTINEL} `))
  const [, verdict, owner, ...path] = (line ?? '').split(' ')
  if (verdict === 'writable') return { state: 'writable' }
  if (verdict === 'unwritable' && owner) {
    return { state: 'unwritable', owner, path: path.join(' ') }
  }
  return { state: 'unknown', reason: 'the access check printed no verdict' }
}

/**
 * The root one-shot that hands a new volume to the burn user. Docker also leaves
 * {@link BURN_CACHE_MARKER_FILE}, so the volume is never empty. Podman keeps its
 * bare chown (decision 10).
 *
 * The entrypoint is overridden either way: the sandbox image's ENTRYPOINT is
 * `sleep infinity` (that is how the burn container is kept alive), so a bare
 * `<image> chown …` would have Docker run `sleep infinity chown -R …` and die
 * on `-R`.
 */
function claimVolumeArgs(
  engine: BurnCacheEngine,
  opts: { name: string; image: string; owner: string },
): string[] {
  const mount = ['-v', `${opts.name}:${BURN_CACHE_MOUNT}`]
  const asRoot = ['run', '--rm', '--user', 'root', '--entrypoint']
  if (engine === 'podman') {
    return [...asRoot, 'chown', ...mount, opts.image, '-R', opts.owner, BURN_CACHE_MOUNT]
  }
  return [
    ...asRoot,
    'sh',
    ...mount,
    opts.image,
    '-c',
    'touch "$1/$3" && chown -R "$2" "$1"',
    'sh',
    BURN_CACHE_MOUNT,
    opts.owner,
    BURN_CACHE_MARKER_FILE,
  ]
}

/**
 * Make the project's cache volume exist and be writable by the burn user.
 *
 * A freshly created volume is owned by root and the burn container cannot fix
 * that itself, hence the one-shot root `run` of {@link claimVolumeArgs}. That
 * runs only on creation: on an existing volume it would be a recursive chown of
 * every file in a multi-gigabyte cache, once per burn.
 *
 * An existing volume is checked instead, on Docker, once per run. A volume the
 * burn user cannot write to is dropped and recreated (decision 4). It cannot
 * hold much worth keeping, since this user could never have filled it, and a
 * chown in place can outrun the engine-command timeout. A check with no clear
 * answer leaves the volume alone: nothing is ever deleted on a guess. Podman
 * keeps create-and-chown-once, because its one-shot runs under a different user
 * mapping from the burn (decision 10).
 *
 * A failed chown removes the volume again before the error propagates, so the
 * next burn starts clean. An unlabelled volume is one a version that did not
 * roll back left behind, and is dropped the same way.
 */
export async function ensureBurnCacheVolume(opts: EnsureBurnCacheVolumeOptions): Promise<void> {
  const { engine, exec } = opts
  const burnUser = opts.burnUser ?? resolveBurnUser(engine)
  const name = burnCacheVolumeName(opts.projectId)
  const state = await inspectBurnCacheVolume(exec, engine, opts.projectId)
  if (state === 'current') {
    if (engine !== 'docker') return
    const access = await checkBurnCacheAccess({ ...opts, burnUser })
    if (access.state !== 'unwritable') return
    opts.onRepair?.(access)
  }
  if (state !== 'missing') await execOrThrow(exec, engine, ['volume', 'rm', name])

  await execOrThrow(exec, engine, [
    'volume',
    'create',
    '--label',
    `${BURN_CACHE_VOLUME_LABEL}=${BURN_CACHE_VOLUME_VERSION}`,
    name,
  ])
  try {
    await execOrThrow(
      exec,
      engine,
      claimVolumeArgs(engine, { name, image: opts.imageName, owner: burnUserSpec(burnUser) }),
    )
  } catch (err) {
    // Roll back so the next burn creates and chowns afresh. Best-effort: the
    // chown error is the one worth surfacing, and the next run's access check
    // catches a leftover volume.
    await exec(engine, ['volume', 'rm', name])
    throw err
  }
}

export interface RemoveBurnCacheVolumeOptions {
  engine: BurnCacheEngine
  projectId: string
  exec: ExecFn
  /** Slots held right now — from the allocator's `held()`. */
  slots: readonly number[]
}

/**
 * Drop the project's cache volume. Refused while any slot is held: the
 * checkouts on the volume are those burns' working trees, and pulling it out
 * from under a running container leaves the agent writing into a deleted mount.
 */
export async function removeBurnCacheVolume(opts: RemoveBurnCacheVolumeOptions): Promise<void> {
  if (opts.slots.length > 0) throw new BurnCacheBusyError([...opts.slots].sort((a, b) => a - b))
  await execOrThrow(opts.exec, opts.engine, ['volume', 'rm', burnCacheVolumeName(opts.projectId)])
}

export interface BurnCacheVolumeSizeOptions {
  engine: BurnCacheEngine
  projectId: string
  exec: ExecFn
}

/**
 * Bytes the project's cache volume occupies, or `null` when it does not exist
 * (or the engine cannot say). Read from `<engine> system df -v`, the only place
 * either engine reports a volume's size.
 *
 * The parse is deliberately tolerant. Docker and Podman disagree about the
 * verbose JSON shape — one nests the volume records under a `Volumes` key, the
 * other emits a record per line; one names the volume `Name`, the other
 * `VolumeName`; sizes come through as raw byte counts from the API types and as
 * human strings ("1.234GB") from the CLI formatter. Rather than pin one shape
 * per engine and be wrong on the next release, this walks whatever JSON came
 * back for a record naming this volume. A size that cannot be read is `null`,
 * never a guess — the operator is shown a size or nothing.
 */
export async function burnCacheVolumeSize(opts: BurnCacheVolumeSizeOptions): Promise<number | null> {
  const out = await opts.exec(opts.engine, ['system', 'df', '-v', '--format', 'json'])
  if (!out.ok || out.code !== 0) return null
  return findVolumeSize(out.stdout, burnCacheVolumeName(opts.projectId))
}

/** Whole-output JSON, else one JSON value per line — both engines have shipped both. */
function parseJsonValues(stdout: string): unknown[] {
  const values: unknown[] = []
  const whole = tryParseJson(stdout)
  if (whole !== undefined) return [whole]
  for (const line of stdout.split('\n')) {
    const value = tryParseJson(line)
    if (value !== undefined) values.push(value)
  }
  return values
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

const VOLUME_NAME_KEYS = ['Name', 'VolumeName'] as const

/** Depth-first walk for the first record naming `name`, returning its size. */
function findVolumeSize(stdout: string, name: string): number | null {
  const pending: unknown[] = parseJsonValues(stdout)
  while (pending.length > 0) {
    const node = pending.shift()
    if (Array.isArray(node)) {
      pending.push(...node)
      continue
    }
    if (typeof node !== 'object' || node === null) continue
    const record = node as Record<string, unknown>
    if (VOLUME_NAME_KEYS.some((key) => record[key] === name)) {
      const size = readSize(record)
      if (size !== null) return size
    }
    pending.push(...Object.values(record))
  }
  return null
}

/** `Size`, or the `UsageData.Size` the engines' API types nest it under. */
function readSize(record: Record<string, unknown>): number | null {
  const usage = record.UsageData
  const nested =
    typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>).Size : undefined
  return parseSize(record.Size) ?? parseSize(nested)
}

/** Decimal (kB/MB/GB — what both CLIs print) and binary (KiB/MiB) suffixes. */
const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5,
}

/** Bytes from a raw count or a human string, or `null` when it is neither. */
function parseSize(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(value)
  if (!match) return null
  const amount = Number(match[1])
  const unit = SIZE_UNITS[(match[2] || 'b').toLowerCase()]
  if (!Number.isFinite(amount) || unit === undefined) return null
  return Math.round(amount * unit)
}

// ---------------------------------------------------------------------------
// Slot allocation
// ---------------------------------------------------------------------------

/** No free slot: every one of `burnConcurrency` is already held by a burn. */
export class BurnSlotsExhaustedError extends Error {
  constructor(capacity: number) {
    super(`all ${capacity} burn cache slots are in use`)
    this.name = 'BurnSlotsExhaustedError'
  }
}

/**
 * Who owns which persistent checkout right now. Purely in memory, and
 * deliberately so: the server is the only thing that spawns burns, and a
 * restart kills them all — so a slot can never be "stuck" the way a lock file
 * on the volume could be (decision 4).
 */
export interface SlotAllocator {
  /** The lowest free slot, marked held. Throws {@link BurnSlotsExhaustedError} at capacity. */
  claim(): number
  /** Give a slot back. Releasing one that is not held is a no-op. */
  release(slot: number): void
  /** Slots held right now, ascending. */
  held(): number[]
  /**
   * Retune the width. `burnConcurrency` is an operator setting with no restart
   * requirement, so the shared allocator has to follow it; slots already held
   * above a lowered capacity stay held until their burn exits.
   */
  resize(capacity: number): void
}

/**
 * Slots are numbered `1..capacity` and handed out lowest-free-first, so a
 * quiet server keeps reusing slot 1 and its warm checkout instead of spreading
 * cold ones across the volume.
 */
export function createSlotAllocator(capacity: number): SlotAllocator {
  const heldSlots = new Set<number>()
  let width = capacity
  return {
    claim() {
      for (let slot = 1; slot <= width; slot++) {
        if (!heldSlots.has(slot)) {
          heldSlots.add(slot)
          return slot
        }
      }
      throw new BurnSlotsExhaustedError(width)
    },
    release(slot) {
      heldSlots.delete(slot)
    },
    held() {
      return [...heldSlots].sort((a, b) => a - b)
    },
    resize(next) {
      width = next
    },
  }
}

let sharedAllocator: SlotAllocator | undefined

/**
 * The one allocator the whole process shares — burns claim from it, and the
 * clear-cache mutation reads `held()` to decide whether to refuse. It must be a
 * singleton for either to mean anything, so `capacity` retunes the existing
 * instance rather than making a second one.
 */
export function getBurnSlotAllocator(capacity: number): SlotAllocator {
  if (!sharedAllocator) sharedAllocator = createSlotAllocator(capacity)
  else sharedAllocator.resize(capacity)
  return sharedAllocator
}
