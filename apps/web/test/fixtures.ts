import type { Waypoint } from '../src/lib/feature-ui'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'

/**
 * The wire payloads the derivation and rendering tests build their cases on.
 *
 * They started out local to `feature-ui.test.ts`; they live here because the
 * retired-vocabulary sweep renders the next-step bar in every ideation, spec and
 * tickets state and has to build the same features to do it. A fixture copied
 * into a second file is a fixture that drifts from the one it was copied from.
 */
export function listItem(over: Partial<FeatureListItem> = {}): FeatureListItem {
  return {
    id: over.id ?? 'feat_1',
    projectId: 'proj_1',
    slug: over.slug ?? 'demo',
    title: 'Demo',
    oneLiner: '',
    mapped: false,
    phase: over.phase ?? 'tickets',
    branch: 'feature/demo',
    baseBranch: 'main',
    status: over.status ?? 'active',
    createdAt: 0,
    ticketCounts: over.ticketCounts ?? {
      total: 0,
      pending: 0,
      burning: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    },
    activeRun: over.activeRun ?? false,
    liveSession: over.liveSession ?? null,
    lastActivityAt: over.lastActivityAt ?? 0,
  } as FeatureListItem
}

/** A feature with nothing on it yet — no tickets, sessions, docs or waypoints. */
export function full(over: Partial<FeatureFull['feature']> = {}): FeatureFull {
  return {
    feature: { ...listItem(over as Partial<FeatureListItem>) } as FeatureFull['feature'],
    tickets: [],
    sessions: [],
    runs: [],
    docs: [],
    gate: { next: null, satisfied: false },
    waypoints: [],
    frontierIds: [],
  } as unknown as FeatureFull
}

/** One waypoint of a mapped feature: open, unblocked and unclaimed by default. */
export function wp(over: Partial<Waypoint> & Pick<Waypoint, 'id' | 'seq' | 'title'>): Waypoint {
  return {
    featureId: 'feat_1',
    type: 'grilling',
    question: `what about ${over.title}?`,
    blockedBy: [],
    originWaypointId: null,
    status: 'open',
    claimedBy: null,
    lastSessionId: null,
    summary: null,
    ...over,
  } as Waypoint
}
