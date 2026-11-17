/**
 * Remove what a drive's runcastle made in the container engine before its data
 * folder goes (feature `runcastle-cleans-up-after-itself`, decision 6): every
 * container and volume labelled `runcastle.data-dir=<that folder>`.
 *
 * Self-contained like the rest of the drive scripts. The label name is the one
 * `LABEL_DATA_DIR` in `@runcastle/core` (labels.ts) stamps; it is repeated here
 * because this hook runs with nothing but bun and this folder.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DATA_DIR_LABEL = 'runcastle.data-dir'

export type DriveEngine = 'docker' | 'podman'

/** Run one engine command; null when it could not run or failed. */
export type EngineExec = (engine: DriveEngine, args: string[]) => string | null

const ENGINE_TIMEOUT_MS = 60_000

export const spawnEngine: EngineExec = (engine, args) => {
  const out = spawnSync(engine, args, {
    encoding: 'utf8',
    timeout: ENGINE_TIMEOUT_MS,
    windowsHide: true,
    // No shell: the label filter carries a path, which may hold spaces.
  })
  return out.status === 0 ? out.stdout : null
}

/**
 * The engine the drive's runcastle used, from its `config.json` `sandbox`; both
 * when the config cannot be read (the folder may already be gone).
 */
export function driveEngines(dir: string): DriveEngine[] {
  const path = join(dir, 'config.json')
  if (!existsSync(path)) return ['docker', 'podman']
  try {
    const sandbox = (JSON.parse(readFileSync(path, 'utf8')) as { sandbox?: unknown }).sandbox
    // Runcastle reads anything else as docker, its default.
    return sandbox === 'podman' ? ['podman'] : ['docker']
  } catch {
    return ['docker', 'podman']
  }
}

export interface DriveContainersRemoved {
  containers: string[]
  volumes: string[]
}

const lines = (out: string | null): string[] =>
  (out ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * Remove every container (running or not) and then every volume labelled with
 * `dir`. Best effort: an engine that is missing or refuses leaves what it
 * holds for the live install's sweep, which treats a vanished folder's
 * resources as orphans. Never throws.
 */
export function removeDriveContainers(
  dir: string,
  engines: DriveEngine[] = driveEngines(dir),
  exec: EngineExec = spawnEngine,
): DriveContainersRemoved {
  const removed: DriveContainersRemoved = { containers: [], volumes: [] }
  const filter = ['--filter', `label=${DATA_DIR_LABEL}=${dir}`]
  for (const engine of engines) {
    const containers = lines(exec(engine, ['ps', '-a', '-q', ...filter]))
    if (containers.length > 0 && exec(engine, ['rm', '-f', ...containers]) !== null) {
      removed.containers.push(...containers)
    }
    // After the containers, which would otherwise hold their volumes.
    const volumes = lines(exec(engine, ['volume', 'ls', '-q', ...filter]))
    if (volumes.length > 0 && exec(engine, ['volume', 'rm', '-f', ...volumes]) !== null) {
      removed.volumes.push(...volumes)
    }
  }
  return removed
}
