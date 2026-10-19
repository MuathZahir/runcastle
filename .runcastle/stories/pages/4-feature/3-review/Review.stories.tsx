import type { Meta, StoryObj } from '@storybook/react-vite'
import { EMPTY_DISCOVERY_SNAPSHOT } from '../../../../../packages/core/src/schemas'
import type { FeatureFull, RouterOutputs } from '../../../../../apps/web/src/lib/api'
import { REVIEW_ARTIFACTS_KEY, type ReviewArtifacts } from '../../../../../apps/web/src/lib/reviews'
import { full, listItem } from '../../../../../apps/web/test/fixtures'
import { AppAt } from '../../../../storybook/app-at'
import { withApi } from '../../../../storybook/fake-api'
import { PROJECT_ID, withShell } from '../../../../storybook/shell-fakes'

/**
 * A feature at review, as the whole app shows it at the feature's address:
 * sidebar, topbar and the review page, every read answered by the story's
 * fakes at the network edge (`.runcastle/storybook/fake-api.ts`) on top of the
 * shell's defaults (`shell-fakes.ts`).
 */
const FEATURE_ID = 'feat_1'
const SLUG = 'coupon-codes'
const TITLE = 'Coupon codes'
const row = {
  ...listItem({ id: FEATURE_ID, slug: SLUG, phase: 'review' }),
  title: TITLE,
  branch: `feature/${SLUG}`,
  // Started three days before whenever the story is looked at.
  createdAt: Date.now() - 3 * 86_400_000,
}
const base = full({ id: FEATURE_ID, slug: SLUG, phase: 'review' })

const ticket = (over: Partial<FeatureFull['tickets'][number]>) =>
  ({
    id: 'tkt_1',
    seq: 1,
    lap: 1,
    title: 'apply a coupon at checkout',
    kind: 'implementation',
    status: 'done',
    commits: [],
    ...over,
  }) as unknown as FeatureFull['tickets'][number]

const RUN_ID = 'run_1'

const feature: FeatureFull = {
  ...base,
  feature: { ...base.feature, ...row, lap: 1 },
  tickets: [
    ticket({}),
    ticket({ id: 'tkt_2', seq: 2, title: 'show an expired coupon' }),
    ticket({ id: 'tkt_review', seq: 3, title: 'review the lap', kind: 'review' }),
  ],
  runs: [
    {
      id: RUN_ID,
      featureId: FEATURE_ID,
      workflow: 'ticket-burner',
      status: 'succeeded',
      startedAt: 1,
      endedAt: 900,
      summary: 'Coupons apply at checkout; the review found two defects.',
    },
  ],
}

// The open work shows once drive notes are open — a drive is up, or the lead
// has declared the feature ready (`the-feature-lead-runs-rounds` decision 24).
// So the page is faked one round in, declared ready after it.
const rounds: RouterOutputs['feature']['rounds'] = [
  {
    round: 1,
    runId: RUN_ID,
    status: 'succeeded',
    ticketSeqs: [1, 2, 3],
    landed: [1, 2, 3],
    failed: [],
    gates: { ok: true, failed: [] },
    startedAt: 1,
    finishedAt: 900,
  },
]

const declarations: RouterOutputs['feature']['readyDeclarations'] = [
  {
    id: 'ready_1',
    featureId: FEATURE_ID,
    runId: RUN_ID,
    scenario: 'checkout-with-coupon',
    whatToTest: 'Apply SPRING24 at checkout, then try it again after it expires.',
    createdAt: 950,
  },
]

type ReviewFinding = RouterOutputs['findings']['listByFeature']['findings'][number]

const defect = (over: Partial<ReviewFinding> & { id: string; title: string }): ReviewFinding => ({
  featureId: FEATURE_ID,
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'medium',
  location: 'apps/web/src/checkout/CouponField.tsx:42',
  citation: 'spec.md §Expired coupons',
  detail: 'An expired code is accepted and the total drops anyway.',
  reproStep: 'Enter SPRING24 after its end date and press Apply.',
  status: 'open',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  carriedLap: null,
  resolvedBy: null,
  resolutionNote: null,
  createdAt: 1,
  ...over,
})

const findings = [
  defect({ id: 'find_1', title: 'an expired coupon still discounts the total', severity: 'high' }),
  defect({
    id: 'find_2',
    title: 'the coupon error is not announced to screen readers',
    location: 'apps/web/src/checkout/CouponField.tsx:61',
  }),
]

const pass: ReviewArtifacts = {
  ticketId: 'tkt_review',
  seq: 3,
  lap: 1,
  passKind: 'review',
  reviewMode: 'gates',
  reviewVerdict: 'verified',
  reviewVerdictReason: null,
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: false,
  videoUrl: null,
}

const meta = {
  title: 'Feature/Review',
  render: () => <AppAt path={`/p/${PROJECT_ID}/f/${SLUG}`} />,
  parameters: {
    layout: 'fullscreen',
    ...withApi({
      trpc: withShell({
        findings: {
          listByFeature: () => ({
            findings,
            openDefects: findings,
            carriedFindings: [],
            summary: { found: 2, fixed: 0, open: 2, observations: 0 },
          }),
        },
        notes: { list: () => [], delivery: () => ({ waitingSince: null, lastFailure: null }) },
        events: { list: () => [], listByProject: () => [] },
        feature: {
          list: () => [row],
          get: () => feature,
          // No catalogue built on this branch, so no "UI states" section.
          uiStates: () => null,
          mergeDelta: () => ({ base: 'main', commits: 6, files: 9 }),
          goWarnings: () => [],
          driveScenarios: () => ({ runnerConfigured: false, scenarios: [] }),
          rounds: () => rounds,
          readyDeclarations: () => declarations,
        },
        docs: { read: () => ({ content: '# Coupon codes\n' }) },
        settings: { get: () => ({ fields: [], discovery: EMPTY_DISCOVERY_SNAPSHOT }) },
        ticket: { durationStats: () => ({ medianMs: 240_000, sampleSize: 12 }) },
        project: { drivePrerequisites: () => ({ missing: [] }) },
      }),
      cache: [[[REVIEW_ARTIFACTS_KEY, FEATURE_ID], [pass]]],
    }),
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const FindingsOpen: Story = { name: 'Findings open' }
