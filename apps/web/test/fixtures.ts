import type { MapGroup, MapHistoryEntry, MapModel } from '@runcastle/core'
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
  page: false,
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

/**
 * The map (the-map-of-stories-and-scenarios), as `project.map` returns it.
 * Frames load nothing: happy-dom really fetches an iframe's `src`.
 */
export const MAP_FRAME = 'about:blank#'

/** Midday UTC in 2026, so the day reads the same in any test machine's zone. */
export const day = (month: number, date: number): number => Date.UTC(2026, month - 1, date, 12)

export const mergedBy = (title: string, at: number): MapHistoryEntry => ({
  commit: `c${at}`,
  at,
  subject: `Merge branch 'feature/${title.toLowerCase()}'`,
  featureSlug: title.toLowerCase(),
  featureId: `feat_${title.toLowerCase()}`,
  featureTitle: title,
})

export const onMain = (subject: string, at: number): MapHistoryEntry => ({ commit: `m${at}`, at, subject })

const mapState = (id: string, name: string, step: number | null = null) => ({ id, name, step, frameUrl: `${MAP_FRAME}${id}` })

/** Checkout › Coupons: two components (2 + 3 states), two ways in, one call. */
export const couponsGroup = (over: Partial<MapGroup> = {}): MapGroup => ({
  id: 'checkout/coupons',
  name: 'Coupons',
  parentId: 'checkout',
  pages: [
    {
      importPath: 'src/CouponBadge.stories.tsx',
      history: [onMain('fix badge spacing', day(9, 30))],
      states: [mapState('coupon-badge--default', 'Default'), mapState('coupon-badge--stacked', 'Stacked')],
    },
    {
      importPath: 'src/CouponField.stories.tsx',
      history: [
        mergedBy('Coupons', day(10, 12)),
        mergedBy('Checkout', day(9, 2)),
        onMain('rename coupon prop', day(8, 20)),
        mergedBy('Cart', day(7, 1)),
      ],
      states: [
        mapState('coupon-field--empty', 'Empty'),
        mapState('coupon-field--applied', 'Applied'),
        mapState('coupon-field--expired', 'Expired'),
      ],
    },
  ],
  scenarios: [
    {
      file: '.runcastle/scenarios/checkout/coupons/cart-with-coupon.ts',
      name: 'Cart with coupon',
      history: [mergedBy('Coupons', day(10, 12))],
      call: {
        file: '.runcastle/scenarios/checkout/coupons/cart-with-coupon.http',
        requestLine: 'POST /api/cart/coupon',
      },
    },
    {
      file: '.runcastle/scenarios/checkout/coupons/expired-coupon.ts',
      name: 'Expired coupon',
      history: [mergedBy('Coupons', day(10, 11)), onMain('seed an older coupon', day(9, 1))],
    },
  ],
  ...over,
})

/** Auth (3 states, 2 ways in, 1 call), Checkout (nothing of its own) and Checkout › Coupons. */
export const mapModel = (over: Partial<MapModel> = {}): MapModel => ({
  storiesSetUp: true,
  catalogue: {
    state: 'built',
    commit: 'a41c09e' + 'e'.repeat(33),
    builtAt: Date.now() - 2 * 3_600_000,
    stale: false,
    building: false,
  },
  groups: [
    {
      id: 'auth',
      name: 'Auth',
      pages: [
        {
          importPath: 'src/SignIn.stories.tsx',
          history: [],
          states: [
            mapState('sign-in--empty', 'Empty'),
            mapState('sign-in--error', 'Error'),
            mapState('sign-in--busy', 'Busy'),
          ],
        },
      ],
      scenarios: [
        {
          file: '.runcastle/scenarios/auth/signed-out.ts',
          name: 'Signed out',
          history: [],
          call: { file: '.runcastle/scenarios/auth/signed-out.http' },
        },
        { file: '.runcastle/scenarios/auth/locked.ts', name: 'Locked', history: [] },
      ],
    },
    { id: 'checkout', name: 'Checkout', pages: [], scenarios: [] },
    couponsGroup(),
  ],
  ...over,
})
