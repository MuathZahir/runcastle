import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReviewBody } from '../../../apps/web/src/components/bodies/ReviewBody'
import type { FeatureFull, RouterOutputs } from '../../../apps/web/src/lib/api'
import { REVIEW_ARTIFACTS_KEY, type ReviewArtifacts } from '../../../apps/web/src/lib/reviews'
import { full } from '../../../apps/web/test/fixtures'
import { withApi } from '../../storybook/fake-api'

/**
 * The feature page at review, whole: the page reads its own data — findings,
 * notes, the drive, the project's prep — through tRPC, and every read is
 * answered by the story's fakes at the network edge (`.runcastle/storybook/
 * fake-api.ts`). Nothing below the app shell opens the live event stream.
 */
const FEATURE_ID = 'feat_1'
const base = full({ id: FEATURE_ID, slug: 'coupon-codes', phase: 'review' })

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

const feature: FeatureFull = {
  ...base,
  feature: { ...base.feature, title: 'Coupon codes', lap: 1 },
  tickets: [
    ticket({}),
    ticket({ id: 'tkt_2', seq: 2, title: 'show an expired coupon' }),
    ticket({ id: 'tkt_review', seq: 3, title: 'review the lap', kind: 'review' }),
  ],
}

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
  title: 'Feature page/Review',
  component: ReviewBody,
  parameters: {
    layout: 'fullscreen',
    ...withApi({
      trpc: {
        findings: {
          listByFeature: () => ({
            findings,
            openDefects: findings,
            carriedFindings: [],
            summary: { found: 2, fixed: 0, open: 2, observations: 0 },
          }),
        },
        notes: { list: () => [] },
        events: { list: () => [] },
        feature: { driveInfo: () => null, driveScenarios: () => ({ runnerConfigured: false, scenarios: [] }) },
        project: {
          list: () => [],
          prep: () => ({ pendingKeys: [], findings: [], prepared: true, empty: false, preparedAt: 1, dryRun: null }),
          drivePrerequisites: () => ({ missing: [] }),
        },
      },
      cache: [[[REVIEW_ARTIFACTS_KEY, FEATURE_ID], [pass]]],
    }),
  },
  args: { full: feature, driving: null, conflict: null },
} satisfies Meta<typeof ReviewBody>

export default meta
type Story = StoryObj<typeof meta>

export const WithOpenFindings: Story = {}
