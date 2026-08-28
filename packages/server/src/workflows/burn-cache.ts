import type { ExecFn } from '../doctor/doctor'
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
    TMPDIR: `${BURN_CACHE_MOUNT}/tmp`,
    NODE_COMPILE_CACHE: `${BURN_CACHE_MOUNT}/node-compile`,
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

/** The UID:GID every burn container runs as (research #32; the image bakes it in). */
const CONTAINER_USER = '1000:1000'

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
}

/**
 * Make the project's cache volume exist and be writable by the burn user.
 *
 * A freshly created volume is owned by root, and the burn container always runs
 * `--user 1000:1000` and so cannot fix that itself — hence the one-shot
 * `run --rm --user root` that chowns the mount point. That runs ONLY on first
 * creation: on an existing volume it would be a pointless recursive chown of
 * every file in a multi-gigabyte cache, once per burn. `volume create` is
 * issued either way because it is idempotent and is what actually guarantees
 * the volume exists.
 */
export async function ensureBurnCacheVolume(opts: EnsureBurnCacheVolumeOptions): Promise<void> {
  const { engine, exec } = opts
  const name = burnCacheVolumeName(opts.projectId)
  const inspect = await exec(engine, ['volume', 'inspect', name])
  const existed = inspect.ok && inspect.code === 0

  await execOrThrow(exec, engine, ['volume', 'create', name])
  if (existed) return

  await execOrThrow(exec, engine, [
    'run',
    '--rm',
    '--user',
    'root',
    '-v',
    `${name}:${BURN_CACHE_MOUNT}`,
    opts.imageName,
    'chown',
    '-R',
    CONTAINER_USER,
    BURN_CACHE_MOUNT,
  ])
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
