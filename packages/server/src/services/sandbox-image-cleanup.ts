import { existsSync } from 'node:fs'
import {
  DEFAULT_SANDBOX_IMAGE,
  LABEL_DATA_DIR as DATA_DIR_LABEL,
  LABEL_OWNER as OWNER_LABEL,
  LABEL_PROJECT as PROJECT_LABEL,
  OWNER_VALUE,
} from '@runcastle/core'
import { sameDataDir } from '@runcastle/core/paths'
import type { ExecFn } from '../doctor/doctor'
import { tryImageBuildSlot } from './image-build'
import { builderNamePrefix, DOCKERFILE_HASH_LABEL, removeBuilderArgs } from './sandbox-image'
import type { Runtime } from './setup'

/**
 * Removing the sandbox images runcastle no longer needs (feature
 * `runcastle-cleans-up-after-itself`, decision 8): the image a rebuild replaced,
 * and the image of a project that is gone. Never an image a container uses,
 * and never one runcastle did not build.
 *
 * Runcastle's images are found by {@link DOCKERFILE_HASH_LABEL}, which every
 * build since the label existed stamps. A tagged image must also wear only
 * runcastle's own tags (`sandcastle:runcastle` or `sandcastle:runcastle-*`),
 * because an image someone builds `FROM` runcastle's inherits its labels.
 */

export interface StaleImage {
  id: string
  tags: string[]
  reason: 'dangling' | 'project-gone'
  /** The image's size as the engine reports it; layers shared with other images are counted too. */
  bytes: number
}

export interface StaleImagesResult {
  removed: StaleImage[]
  freedBytes: number
  /** Images that should have gone but the engine refused (in use, a child image, …). */
  failed: { id: string; tags: string[]; error: string }[]
}

export interface RemoveStaleSandboxImagesInput {
  engine: Runtime
  exec: ExecFn
  /** This install's data folder: images marked with another live install's folder are left alone. */
  dataDir: string
  /**
   * The projects this install has. Omitted, no image is removed for its project
   * being gone, only the dangling ones: what a build calls once it has replaced
   * an image.
   */
  liveProjectIds?: readonly string[]
  /** Whether a data folder exists; the real file system unless a test injects one. */
  exists?: (path: string) => boolean
}

interface ImageRecord {
  id: string
  tags: string[]
  bytes: number
  labels: Record<string, string>
}

/** One line per image: id, size, tags and labels, tab-separated. Both engines answer it. */
const INSPECT_FORMAT = '{{.Id}}\t{{.Size}}\t{{json .RepoTags}}\t{{json .Config.Labels}}'

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '') as unknown
  } catch {
    return null
  }
}

function parseImageLine(line: string): ImageRecord | null {
  const [id, size, tagsJson, labelsJson] = line.split('\t')
  if (!id) return null
  const tags = parseJson(tagsJson)
  const labels = parseJson(labelsJson)
  return {
    id,
    bytes: Number(size) || 0,
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === 'string' && !t.includes('<none>'))
      : [],
    labels:
      typeof labels === 'object' && labels !== null && !Array.isArray(labels)
        ? Object.fromEntries(
            Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'),
          )
        : {},
  }
}

/** A tag runcastle builds under: the stock image, or a project's. */
function isRuncastleTag(tag: string): boolean {
  // Podman prefixes a short name with `localhost/`.
  const bare = tag.replace(/^localhost\//, '')
  return bare === DEFAULT_SANDBOX_IMAGE || bare.startsWith(`${DEFAULT_SANDBOX_IMAGE}-`)
}

/** The project a tagged project image was built for, from its tag; null for the stock tag or a legacy name. */
function projectFromTag(tag: string): string | null {
  const bare = tag.replace(/^localhost\//, '')
  const prefix = `${DEFAULT_SANDBOX_IMAGE}-`
  if (!bare.startsWith(prefix)) return null
  const id = bare.slice(prefix.length)
  // Only a project id: older versions tagged by project NAME, which a global
  // setting may still name, so those are never judged gone.
  return id.startsWith('proj_') ? id : null
}

/** Every image id some container (running or not) was created from; null when the engine could not say. */
async function imagesInUse(engine: Runtime, exec: ExecFn): Promise<Set<string> | null> {
  const ps = await exec(engine, ['ps', '-a', '-q', '--no-trunc'])
  if (!ps.ok || ps.code !== 0) return null
  const ids = ps.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  if (ids.length === 0) return new Set()
  const inspect = await exec(engine, ['container', 'inspect', '--format', '{{.Image}}', ...ids])
  // A container removed between the two calls fails the inspect; trust nothing then.
  if (!inspect.ok || inspect.code !== 0) return null
  return new Set(inspect.stdout.split('\n').map((l) => normaliseId(l.trim())).filter(Boolean))
}

function normaliseId(id: string): string {
  return id.replace(/^sha256:/, '')
}

/**
 * Remove runcastle's sandbox images that nothing needs: dangling ones (a rebuild
 * replaced them) and those whose project this install no longer has. Never one a
 * container was created from, never one wearing a tag runcastle does not build,
 * and never one marked with another install's data folder that still exists.
 *
 * Best effort and never throws: an engine that cannot list leaves everything,
 * and a refused removal is reported in `failed`. Emits nothing itself; the
 * caller (the sweep, or a build) says what came of it.
 */
export async function removeStaleSandboxImages(
  input: RemoveStaleSandboxImagesInput,
): Promise<StaleImagesResult> {
  const { engine, exec, dataDir, liveProjectIds } = input
  const exists = input.exists ?? existsSync
  const result: StaleImagesResult = { removed: [], freedBytes: 0, failed: [] }

  const listed = await exec(engine, [
    'images',
    '-q',
    '--no-trunc',
    '--filter',
    `label=${DOCKERFILE_HASH_LABEL}`,
  ])
  if (!listed.ok || listed.code !== 0) return result
  const ids = [...new Set(listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean))]
  if (ids.length === 0) return result

  const inspected = await exec(engine, ['image', 'inspect', '--format', INSPECT_FORMAT, ...ids])
  if (!inspected.ok || inspected.code !== 0) return result
  const inUse = await imagesInUse(engine, exec)
  if (inUse === null) return result

  const live = liveProjectIds ? new Set(liveProjectIds) : null
  for (const line of inspected.stdout.split('\n')) {
    const image = parseImageLine(line.trim())
    if (!image) continue
    // The listing filtered on it; checked again so a parse slip can never widen the net.
    if (!(DOCKERFILE_HASH_LABEL in image.labels)) continue
    const owner = image.labels[OWNER_LABEL]
    if (owner !== undefined && owner !== OWNER_VALUE) continue
    const markedDir = image.labels[DATA_DIR_LABEL]
    if (markedDir && !sameDataDir(markedDir, dataDir) && exists(markedDir)) continue
    if (image.tags.some((tag) => !isRuncastleTag(tag))) continue
    if (inUse.has(normaliseId(image.id))) continue

    let reason: StaleImage['reason'] | null = null
    if (image.tags.length === 0) reason = 'dangling'
    else if (live) {
      const projects = new Set(
        [image.labels[PROJECT_LABEL], ...image.tags.map(projectFromTag)].filter(
          (p): p is string => typeof p === 'string' && p !== '',
        ),
      )
      // Every tag must name a gone project: the stock tag names none and stays.
      const tagsAllProject = image.tags.every((tag) => projectFromTag(tag) !== null)
      if (tagsAllProject && projects.size > 0 && [...projects].every((p) => !live.has(p))) {
        reason = 'project-gone'
      }
    }
    if (!reason) continue

    // Never forced: the engine itself refuses an image a container still uses.
    const target = image.tags.length > 0 ? image.tags : [image.id]
    const out = await exec(engine, ['rmi', ...target])
    if (out.ok && out.code === 0) {
      result.removed.push({ id: image.id, tags: image.tags, reason, bytes: image.bytes })
      result.freedBytes += image.bytes
    } else {
      result.failed.push({
        id: image.id,
        tags: image.tags,
        error: out.stderr.trim() || `exit ${out.code ?? 'unknown'}`,
      })
    }
  }
  return result
}

/**
 * Remove this install's own buildx builders that a killed build left behind
 * (the server died between creating one and removing it). Skipped while this
 * server is building, which is the one time a builder of ours is in use.
 * Returns the names removed. Docker only; never throws.
 */
export async function removeLeftoverBuilders(input: {
  exec: ExecFn
  dataDir: string
}): Promise<string[]> {
  const release = tryImageBuildSlot()
  if (!release) return []
  try {
    const listed = await input.exec('docker', ['buildx', 'ls'])
    if (!listed.ok || listed.code !== 0) return []
    const prefix = builderNamePrefix(input.dataDir)
    const names = new Set(
      listed.stdout
        .split('\n')
        // A builder's own line starts at the margin; its nodes are indented under it.
        .filter((line) => /^\S/.test(line))
        .map((line) => line.split(/\s+/)[0]?.replace(/\*$/, '') ?? '')
        .filter((name) => name.startsWith(prefix)),
    )
    const removed: string[] = []
    for (const name of names) {
      const out = await input.exec('docker', removeBuilderArgs(name))
      if (out.ok && out.code === 0) removed.push(name)
    }
    return removed
  } finally {
    release()
  }
}
