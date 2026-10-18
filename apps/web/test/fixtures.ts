import type { FeatureFull, FeatureListItem, UiStatesModel, UiStatesStory } from '../src/lib/api'

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
    phase: over.phase ?? 'planning',
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
    lapTally: over.lapTally ?? { landed: 0, total: 0, waived: 0 },
    activeRun: over.activeRun ?? false,
    liveSession: over.liveSession ?? null,
    lastActivityAt: over.lastActivityAt ?? 0,
    dependsOn: over.dependsOn ?? [],
    blocks: over.blocks ?? [],
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
  } as unknown as FeatureFull
}

/** A "UI states" section model, and its stories, as `feature.uiStates` returns them. */
export const FEATURE_FRAME = 'http://localhost:4514/features/feat_x/iframe.html?id='
export const BASE_FRAME = `http://localhost:4514/base/${'b'.repeat(40)}/iframe.html?id=`

export const uiStory = (id: string, name: string, base: boolean): UiStatesStory => ({
  id,
  title: 'Checkout/Coupon field',
  name,
  frameUrl: `${FEATURE_FRAME}${id}&viewMode=story`,
  baseFrameUrl: base ? `${BASE_FRAME}${id}&viewMode=story` : null,
})

export const uiStatesModel = (over: Partial<UiStatesModel> = {}): UiStatesModel => ({
  status: 'built',
  reason: null,
  log: null,
  commit: '4e1c9a0' + 'f'.repeat(33),
  baseCommit: 'b'.repeat(40),
  base: 'built',
  lap: 1,
  builtAt: 1,
  changed: [uiStory('checkout-coupon--expired', 'Expired', true)],
  new: [uiStory('checkout-coupon--expiring', 'Expiring soon', false)],
  affected: [
    uiStory('checkout-summary--with-coupon', 'With coupon', false),
    uiStory('cart-drawer--discount', 'With discount', false),
  ],
  ...over,
})
