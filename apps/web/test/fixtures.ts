import type { Need } from '@runcastle/core'
import type { FeatureFull, FeatureListItem } from '../src/lib/api'

/** A need as `feature.list` / `feature.get` carry it: the agent's line, in the lead's chat unless `over` says. */
export function need(why: string, over: Partial<Need> = {}): Need {
  return { why, since: 1, threadId: 'lead-chat', by: 'agent', ...over }
}

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
    workersWorking: over.workersWorking ?? 0,
    workerProgress: over.workerProgress ?? { counted: 0, landed: 0 },
    liveSession: over.liveSession ?? null,
    leadInBackground: over.leadInBackground ?? false,
    working: over.working ?? false,
    need: over.need ?? null,
    lastActivityAt: over.lastActivityAt ?? 0,
    dependsOn: over.dependsOn ?? [],
    blocks: over.blocks ?? [],
    upNext: over.upNext ?? false,
    upNextProblem: over.upNextProblem ?? null,
  } as FeatureListItem
}

/** A feature with nothing on it yet — no tickets, sessions or docs. */
export function full(over: Partial<FeatureFull['feature']> = {}): FeatureFull {
  return {
    feature: { ...listItem(over as Partial<FeatureListItem>) } as FeatureFull['feature'],
    tickets: [],
    sessions: [],
    runs: [],
    docs: [],
    gate: { next: null, satisfied: false },
    dependsOn: [],
    blocks: [],
    working: false,
    need: null,
  } as unknown as FeatureFull
}
