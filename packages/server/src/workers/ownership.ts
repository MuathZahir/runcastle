import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { LABEL_DATA_DIR, LABEL_DOCKERFILE_HASH } from '@runcastle/core'
import { sameDataDir } from '@runcastle/core/paths'

/**
 * Whose a container is (runcastle-cleans-up-after-itself decision 5), from
 * what the engine says of it: its labels and mounts. Pure but for the
 * existence check of the data folder it names, which tests inject.
 */

/** Every worker container's name starts with this. */
export const WORKER_CONTAINER_PREFIX = 'runcastle-worker-'

/** Where inside a worker container its origin (the worker's bare copy) is mounted. */
export const ORIGIN_MOUNT = '/home/agent/origin.git'

/** A container as the engine lists it. */
export interface ContainerFacts {
  name: string
  running: boolean
  labels: Record<string, string>
  /** Each mount: a bind's host path or a volume's name (`source`), and where it sits inside. */
  mounts: { type: string; source: string; destination: string }[]
  /** Its writable layer's bytes, when the engine said. */
  sizeBytes?: number
}

/** A volume as the engine lists it. */
export interface VolumeFacts {
  name: string
  labels: Record<string, string>
  sizeBytes?: number
}

/**
 * - `own`: this install's (its data-dir label is this data folder, or, made
 *   before the labels, a worker container whose origin mount lies in this
 *   data folder's `workers/origins`);
 * - `orphan`: runcastle's, of an install whose data folder no longer exists
 *   (any install may remove it);
 * - `burn-engine`: from a runcastle sandbox image but not a worker, so the
 *   retired burn engine's (always removable, decision 7);
 * - `foreign`: another live install's, or not runcastle's at all: never touched.
 */
export type Ownership = 'own' | 'orphan' | 'burn-engine' | 'foreign'

/** Where an install keeps its workers' bare copies. */
export function originsDir(dataDir: string): string {
  return join(dataDir, 'workers', 'origins')
}

function isUnder(path: string, dir: string): boolean {
  const p = resolve(path)
  const d = resolve(dir)
  return p.startsWith(d.endsWith(sep) ? d : d + sep)
}

export function ownershipOf(
  c: Pick<ContainerFacts, 'name' | 'labels' | 'mounts'>,
  dataDir: string,
  exists: (path: string) => boolean = existsSync,
): Ownership {
  const labelled = c.labels[LABEL_DATA_DIR]
  if (labelled) {
    if (sameDataDir(labelled, dataDir)) return 'own'
    return exists(labelled) ? 'foreign' : 'orphan'
  }
  if (c.name.startsWith(WORKER_CONTAINER_PREFIX)) {
    const origin = c.mounts.find((m) => m.destination === ORIGIN_MOUNT)?.source
    if (!origin) return 'foreign'
    if (isUnder(origin, originsDir(dataDir))) return 'own'
    // `<dataDir>/workers/origins/<id>.git`: an install whose data folder is gone left it.
    const theirs = dirname(dirname(dirname(origin)))
    return /[\\/]workers[\\/]origins[\\/][^\\/]+\.git[\\/]?$/.test(origin) && !exists(theirs) ? 'orphan' : 'foreign'
  }
  return c.labels[LABEL_DOCKERFILE_HASH] ? 'burn-engine' : 'foreign'
}

/** Refused: a container this install does not own (another install's, or not runcastle's). */
export class ForeignContainerError extends Error {
  constructor(container: string, dataDir: string | undefined) {
    super(
      `container ${container} belongs to ${dataDir ? `the runcastle install at ${dataDir}` : 'another runcastle install'}, not this one: runcastle leaves it alone`,
    )
    this.name = 'ForeignContainerError'
  }
}
