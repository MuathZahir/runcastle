/**
 * Take one test drive's environment down.
 *
 * Run by the drive's stop hook (`bun .runcastle/drive-stop.ts`) with the same
 * identity the setup hook got, plus whatever setup wrote to
 * `.runcastle/drive.env` overlaid on top.
 *
 * The job is deleting the data dir setup created, after removing the containers
 * and volumes the drive's runcastle labelled with it (`drive-containers.ts`);
 * there is no external database. What deserves the care is making
 * sure it deletes only THAT dir: `~/.runcastle` (the developer's live install)
 * and `~/.runcastle-dev` (their dev tree) are siblings of it, an unset variable
 * is the normal failure mode of an env overlay, and `rmdir /s /q` on the wrong
 * one costs them their real projects.
 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { driveEngines, removeDriveContainers } from './drive-containers.ts'
import { DRIVE_PREFIX, isDriveDataDir } from './drive-dir.ts'

/**
 * Prefer what setup computed, fall back to recomputing it from the identity.
 * The fallback is not redundancy for its own sake: if the overlay fails to
 * reach this process the variable is simply absent, and a stop hook that
 * quietly deletes nothing and exits 0 grades as a clean teardown while leaving
 * the tree standing — the one teardown failure that looks exactly like success.
 */
function targetDir(): string {
  const fromEnv = process.env.RUNCASTLE_DATA_DIR
  if (fromEnv) return resolve(fromEnv)

  const id = process.env.RUNCASTLE_ID
  if (!id) throw new Error('neither RUNCASTLE_DATA_DIR nor RUNCASTLE_ID is set — nothing to stop')
  console.warn('[drive-stop] RUNCASTLE_DATA_DIR was not set; recomputing from RUNCASTLE_ID')
  return join(homedir(), `${DRIVE_PREFIX}${id}`)
}

const dir = targetDir()

/**
 * Refuse anything that is not a drive tree. This guard is the reason the naming
 * convention is load-bearing rather than cosmetic.
 */
if (!isDriveDataDir(dir)) {
  throw new Error(`refusing to delete ${dir} — not a ${DRIVE_PREFIX}* tree`)
}

/**
 * The drive's runcastle may have started workers: their containers and cache
 * volumes are labelled with this data dir, and go before it does. Best effort;
 * what stays is an orphan the live install's sweep removes.
 */
const engines = driveEngines(dir)
const removed = removeDriveContainers(dir, engines)
if (removed.containers.length + removed.volumes.length > 0) {
  console.log(
    `[drive-stop] removed ${removed.containers.length} container(s) and ${removed.volumes.length} volume(s) of ${dir}`,
  )
}

/** Idempotent: an already-gone tree is a successful teardown, not an error. */
if (existsSync(dir)) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  console.log(`[drive-stop] removed ${dir}`)
} else {
  console.log(`[drive-stop] ${dir} already gone`)
}
