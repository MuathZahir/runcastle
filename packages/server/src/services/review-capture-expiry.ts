import { lstatSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '@runcastle/core/paths'
import { and, eq, inArray } from 'drizzle-orm'
import { events, features, runs, tickets, workers } from '../db/schema'
import type { Db } from '../db/types'

/**
 * Review captures go 30 days after their feature closes (feature
 * `runcastle-cleans-up-after-itself`, decision 10).
 *
 * A capture folder is `<dataDir>/reviews/<id>`, where the id is the review's
 * own row: a Review worker, a retired burn engine's review ticket, or a run.
 * Each folder is mapped to its feature through those rows and removed when:
 *
 * - the rows name a feature that no longer exists (it was deleted);
 * - the feature shipped or was archived more than 30 days ago (the latest
 *   `feature.shipped` / `feature.archived` event; the folder's own age when
 *   no such event is left);
 * - nothing maps it to a feature and nothing in it changed for 30 days.
 */

export const REVIEW_CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** The ids runcastle names capture folders with; anything else is never treated as one. */
const CAPTURE_ID = /^[\w-]+$/

/**
 * A deleted feature's capture folder that would not go is renamed to this
 * prefix, since its rows (the only map to its feature) go with the delete; the
 * next sweep removes such a folder at once.
 */
export const DELETED_CAPTURE_PREFIX = 'deleted-'

export type CaptureExpiryReason = 'feature-deleted' | 'feature-closed' | 'unmapped'

export interface ExpiredCapture {
  id: string
  /** The project the folder's feature belongs to; null when nothing maps it. */
  projectId: string | null
  featureId: string | null
  reason: CaptureExpiryReason
  bytes: number
}

export interface ReviewCaptureExpiry {
  removed: ExpiredCapture[]
  freedBytes: number
  /** Folders kept because they are still needed. */
  kept: number
  /** Folders that should have gone but could not be removed. */
  failed: { id: string; error: string }[]
}

export interface ExpireReviewCapturesInput {
  db: Db
  /** Epoch ms; the clock the 30 days are measured against. */
  now: number
  /** The data folder to look in; this install's when omitted. */
  dataDir?: string
}

/** The folder's size and its newest change, walked without following links. */
function measure(path: string): { bytes: number; newest: number } {
  let bytes = 0
  let newest = 0
  const pending = [path]
  while (pending.length > 0) {
    const current = pending.pop() as string
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      continue
    }
    newest = Math.max(newest, stat.mtimeMs)
    if (stat.isDirectory()) {
      try {
        for (const name of readdirSync(current)) pending.push(join(current, name))
      } catch {
        // An unreadable folder counts as what was read of it.
      }
    } else {
      bytes += stat.size
    }
  }
  return { bytes, newest }
}

/** Which feature each review id belongs to, from the worker, ticket and run rows. */
function featuresOf(db: Db, ids: string[]): Map<string, string | null> {
  const owner = new Map<string, string | null>()
  if (ids.length === 0) return owner
  for (const row of db
    .select({ id: workers.id, featureId: workers.featureId })
    .from(workers)
    .where(inArray(workers.id, ids))
    .all()) {
    owner.set(row.id, row.featureId)
  }
  for (const table of [tickets, runs] as const) {
    for (const row of db
      .select({ id: table.id, featureId: table.featureId })
      .from(table)
      .where(inArray(table.id, ids))
      .all()) {
      if (!owner.has(row.id)) owner.set(row.id, row.featureId)
    }
  }
  return owner
}

/** When a closed feature last shipped or was archived, or null when no event says. */
function closedAt(db: Db, featureId: string): number | null {
  let latest: number | null = null
  for (const type of ['feature.shipped', 'feature.archived']) {
    for (const row of db
      .select({ ts: events.ts })
      .from(events)
      .where(and(eq(events.type, type), eq(events.featureId, featureId)))
      .all()) {
      latest = Math.max(latest ?? 0, row.ts)
    }
  }
  return latest
}

/**
 * Remove the review capture folders nothing needs any more (decision 10) and
 * say what went. Best effort and never throws. Emits nothing itself: the sweep
 * that calls it puts one line per project on the timeline (decision 11),
 * grouping `removed` by its `projectId`.
 */
export function expireReviewCaptures(input: ExpireReviewCapturesInput): ReviewCaptureExpiry {
  const { db, now } = input
  const root = join(input.dataDir ?? dataDir(), 'reviews')
  const result: ReviewCaptureExpiry = { removed: [], freedBytes: 0, kept: 0, failed: [] }

  let ids: string[]
  try {
    ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && CAPTURE_ID.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return result
  }

  const owners = featuresOf(db, ids)
  const featureIds = [...new Set([...owners.values()].filter((f): f is string => f !== null))]
  const featureRows = new Map(
    featureIds.length === 0
      ? []
      : db
          .select({ id: features.id, projectId: features.projectId, status: features.status })
          .from(features)
          .where(inArray(features.id, featureIds))
          .all()
          .map((row) => [row.id, row] as const),
  )
  const closedCache = new Map<string, number | null>()

  for (const id of ids) {
    const path = join(root, id)
    const featureId = owners.get(id) ?? null
    const feature = featureId ? featureRows.get(featureId) : undefined
    const { bytes, newest } = measure(path)
    const old = now - newest > REVIEW_CAPTURE_TTL_MS

    let reason: CaptureExpiryReason | null = null
    if (id.startsWith(DELETED_CAPTURE_PREFIX) || (featureId && !feature)) reason = 'feature-deleted'
    else if (feature && (feature.status === 'shipped' || feature.status === 'archived')) {
      if (!closedCache.has(feature.id)) closedCache.set(feature.id, closedAt(db, feature.id))
      const closed = closedCache.get(feature.id) ?? null
      if (closed === null ? old : now - closed > REVIEW_CAPTURE_TTL_MS) reason = 'feature-closed'
    } else if (!feature && old) reason = 'unmapped'

    if (!reason) {
      result.kept++
      continue
    }
    try {
      rmSync(path, { recursive: true, force: true })
      result.removed.push({ id, projectId: feature?.projectId ?? null, featureId, reason, bytes })
      result.freedBytes += bytes
    } catch (error) {
      result.failed.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

/**
 * Remove a feature's review capture folders at once, as its delete does
 * (decision 10). Called before the feature's rows go, since they are the map.
 * Best effort: a folder that will not go is left for the sweep. The delete's
 * own `feature.deleted` event covers it.
 */
export function removeFeatureReviewCaptures(db: Db, featureId: string, dir: string = dataDir()): void {
  const ids = [
    ...db.select({ id: workers.id }).from(workers).where(eq(workers.featureId, featureId)).all(),
    ...db.select({ id: tickets.id }).from(tickets).where(eq(tickets.featureId, featureId)).all(),
    ...db.select({ id: runs.id }).from(runs).where(eq(runs.featureId, featureId)).all(),
  ].map((row) => row.id)
  for (const id of ids) {
    if (!CAPTURE_ID.test(id)) continue
    const path = join(dir, 'reviews', id)
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // Marked for the next sweep: once the rows go, nothing else says whose it was.
      try {
        renameSync(path, join(dir, 'reviews', `${DELETED_CAPTURE_PREFIX}${id}`))
      } catch {
        // Left as it is: the 30-day rule for folders nothing maps still takes it.
      }
    }
  }
}
