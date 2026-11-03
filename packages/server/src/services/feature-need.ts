import {
  type EventRow,
  type Feature,
  type FeatureNeed,
  LEAD_WAKE_FAILED,
  LeadWakeFailedData,
  type NeedFacts,
  featureNeed,
  unresolvedMergeConflict,
} from '@runcastle/core'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, readyDeclarations } from '../db/schema'
import { leadState, NO_LEAD, openAskOf, type LeadState } from '../threads/read'
import { designsWaiting } from './designs'
import { getProjectById, hasActiveRun } from './repo'
import { latestBurn } from './runs'

/**
 * What each feature needs from the human (you-always-know-what-s-waiting
 * decision 14), worked out once here from facts the server already has and
 * decided by core's {@link featureNeed}. `feature.list` and `feature.get` carry
 * the answer, and the needs watcher (`need-watch.ts`) pings off its changes.
 */

/** The timeline events a need is read from. */
const NEED_EVENT_TYPES = [
  // when the waiting reason was set
  'feature.waiting',
  'feature.stopped',
  'feature.ready_declared',
  // the human's drives
  'testdrive.stopped',
  // a standing conflict and what clears it (`unresolvedMergeConflict`)
  'merge.conflict',
  'merge.resolved',
  'burn.started',
  'feature.shipped',
  // the lead's wakes
  'lead.message_queued',
  LEAD_WAKE_FAILED,
]

/** A feature's need events, oldest first. */
export type NeedEvents = Pick<EventRow, 'type' | 'ts' | 'data'>[]

type EventPick = { featureId: string | null; type: string; ts: number; data: unknown }

/**
 * Every need event of a project's features in one read, keyed by feature: the
 * list is polled, so it must not cost a timeline scan per feature.
 */
export function needEventsByProject(ctx: AppCtx, projectId: string): Map<string, NeedEvents> {
  const rows = ctx.db
    .select({ featureId: events.featureId, type: events.type, ts: events.ts, data: events.data })
    .from(events)
    .where(and(eq(events.projectId, projectId), inArray(events.type, NEED_EVENT_TYPES)))
    .orderBy(asc(events.id))
    .all() as EventPick[]
  const out = new Map<string, NeedEvents>()
  for (const row of rows) {
    if (row.featureId === null) continue
    const list = out.get(row.featureId) ?? []
    list.push(row)
    out.set(row.featureId, list)
  }
  return out
}

function needEventsOf(ctx: AppCtx, featureId: string): NeedEvents {
  return ctx.db
    .select({ type: events.type, ts: events.ts, data: events.data })
    .from(events)
    .where(and(eq(events.featureId, featureId), inArray(events.type, NEED_EVENT_TYPES)))
    .orderBy(asc(events.id))
    .all()
}

function record(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

/** The facts the timeline holds, folded oldest first. */
function timelineFacts(list: NeedEvents): Pick<NeedFacts, 'conflictSince' | 'humanDriveEndedAt' | 'wakeFailed' | 'wakeQueuedAt'> & {
  waitingSetAt: number | null
} {
  let waitingSetAt: number | null = null
  let humanDriveEndedAt: number | null = null
  let wakeFailed: NeedFacts['wakeFailed'] = null
  let wakeQueuedAt: number | null = null
  for (const e of list) {
    if (e.type === 'feature.waiting' || e.type === 'feature.stopped' || e.type === 'feature.ready_declared') {
      waitingSetAt = e.ts
    } else if (e.type === 'testdrive.stopped') {
      // A review agent's drive is not the human trying the work (decision 5).
      if (record(e.data).purpose !== 'review') humanDriveEndedAt = e.ts
    } else if (e.type === 'lead.message_queued') {
      wakeQueuedAt = e.ts
    } else if (e.type === LEAD_WAKE_FAILED) {
      const data = LeadWakeFailedData.safeParse(e.data)
      wakeFailed = { at: e.ts, exitCode: data.success ? data.data.exitCode : null }
    }
  }
  const conflict = unresolvedMergeConflict(list)
  return { waitingSetAt, humanDriveEndedAt, wakeFailed, wakeQueuedAt, conflictSince: conflict?.at ?? null }
}

/** What a feature's need is read from beyond its row; the list passes what it already read. */
export interface NeedInputs {
  /** The feature's need events, oldest first; read per feature when absent. */
  events?: NeedEvents
  /** The lead's state; read when absent. */
  lead?: LeadState
  /** The project has a test drive set up (a dev command); read when absent. */
  driveConfigured?: boolean
}

/** Gather {@link NeedFacts} for one feature. */
export function needFacts(ctx: AppCtx, feature: Feature, inputs: NeedInputs = {}): NeedFacts {
  const lead = inputs.lead ?? (feature.status === 'active' ? leadState(ctx, feature.id) : NO_LEAD)
  const timeline = timelineFacts(inputs.events ?? needEventsOf(ctx, feature.id))
  const declaration = ctx.db
    .select({ scenario: readyDeclarations.scenario, at: readyDeclarations.createdAt })
    .from(readyDeclarations)
    .where(eq(readyDeclarations.featureId, feature.id))
    .orderBy(desc(readyDeclarations.createdAt), desc(readyDeclarations.id))
    .limit(1)
    .get()
  const driveConfigured = inputs.driveConfigured ?? !!getProjectById(ctx, feature.projectId)?.devCommand
  const designs = designsWaiting(ctx, feature.id)
  return {
    status: feature.status,
    held: !!feature.heldBy,
    agentWorking: hasActiveRun(ctx, feature.id) || lead.working,
    waiting: feature.waitingReason
      ? { reason: feature.waitingReason, kind: feature.waitingKind, since: timeline.waitingSetAt ?? 0 }
      : null,
    leadAwaitsHuman: lead.awaitsHuman ? { since: lead.since } : null,
    openAsk: openAskOf(ctx, feature.id),
    conflictSince: timeline.conflictSince,
    declaration: declaration ?? null,
    latestRoundStartedAt: latestBurn(ctx, feature.id)?.startedAt ?? null,
    humanDriveEndedAt: timeline.humanDriveEndedAt,
    humanMessageAt: feature.lastHumanMessageAt,
    driveConfigured,
    wakeFailed: timeline.wakeFailed,
    wakeQueuedAt: timeline.wakeQueuedAt,
    designsWaiting: designs.count,
    oldestDesignWaitingSince: designs.since,
  }
}

/**
 * The feature's one need, or null. Only a started feature can need anything, so
 * every other one is answered without reading a thing.
 */
export function needOf(ctx: AppCtx, feature: Feature, inputs: NeedInputs = {}, now = Date.now()): FeatureNeed | null {
  if (feature.status !== 'active') return null
  return featureNeed(needFacts(ctx, feature, inputs), now)
}
