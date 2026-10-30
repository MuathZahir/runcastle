import type { DriveScenario, ProjectNote, ScenarioEntry, TestNote } from '@runcastle/core'
import type { SlotDrive } from '../src/lib/use-project-drive'

/**
 * Sample data for the test drive previews (docs/features/test-drive-looks-the-part):
 * a project with many scenarios — the case where the old menu ran down the
 * screen — and the drive in each state the stage can show.
 */

export const FEATURE_ID = 'feat_drive'
export const BRANCH = 'feature/checkout-coupons'

/** The stand-in app the frame shows: a page of this preview server, so it loads. */
export const SAMPLE_APP = `${location.origin}/preview/drive-sample-app.html`

const entry = (file: string, name: string, group?: string, own = false, hasCall = false): ScenarioEntry => ({
  file: `.runcastle/scenarios/${file}`,
  name,
  ...(group ? { group } : {}),
  own,
  hasCall,
})

/** Twenty-six scenarios: three the feature added, the rest the project's, in five groups. */
export const SCENARIOS: ScenarioEntry[] = [
  entry('checkout/expired-coupon.ts', 'Expired coupon at checkout', 'Checkout', true),
  entry('checkout/stacked-coupons.ts', 'Two coupons stacked', 'Checkout', true),
  entry('checkout/coupon-api.ts', 'Apply a coupon over the API', 'Checkout', true, true),
  entry('checkout/empty-cart.ts', 'Empty cart', 'Checkout'),
  entry('checkout/guest.ts', 'Guest checkout', 'Checkout'),
  entry('checkout/saved-card.ts', 'Saved card on file', 'Checkout'),
  entry('checkout/declined-card.ts', 'Card declined', 'Checkout'),
  entry('checkout/three-ds.ts', '3-D Secure challenge', 'Checkout'),
  entry('onboarding/first-visit.ts', 'First visit, nothing set up', 'Onboarding'),
  entry('onboarding/invited.ts', 'Invited to a team', 'Onboarding'),
  entry('onboarding/half-done.ts', 'Wizard left half done', 'Onboarding'),
  entry('orders/many-orders.ts', 'A customer with 300 orders', 'Orders'),
  entry('orders/refund-pending.ts', 'Refund pending', 'Orders'),
  entry('orders/partial-ship.ts', 'Partly shipped order', 'Orders'),
  entry('orders/cancelled.ts', 'Cancelled order', 'Orders'),
  entry('orders/order-api.ts', 'Fetch an order over the API', 'Orders', false, true),
  entry('settings/billing-past-due.ts', 'Billing past due', 'Settings'),
  entry('settings/two-factor.ts', 'Two-factor turned on', 'Settings'),
  entry('settings/sso.ts', 'Signed in through SSO', 'Settings'),
  entry('settings/deleted-account.ts', 'Account scheduled for deletion', 'Settings'),
  entry('admin/support-view.ts', 'Support agent viewing a customer', 'Admin'),
  entry('admin/feature-flags.ts', 'Every feature flag on', 'Admin'),
  entry('admin/audit-log.ts', 'Audit log with a year of events', 'Admin'),
  entry('logged-out.ts', 'Logged out'),
  entry('slow-network.ts', 'Slow network'),
  entry('dark-mode.ts', 'Dark mode user'),
]

const landed: DriveScenario = {
  file: SCENARIOS[0]!.file,
  name: SCENARIOS[0]!.name,
  status: 'landed',
  entryUrl: `${SAMPLE_APP}?scenario=expired-coupon`,
  landingId: 'land_1',
}

const running: DriveScenario = {
  file: SCENARIOS[1]!.file,
  name: SCENARIOS[1]!.name,
  status: 'running',
  output: [
    '$ bun .runcastle/scenarios/checkout/stacked-coupons.ts',
    'seeding customer ana@example.com … ok',
    'creating coupons SPRING10, WELCOME5 … ok',
    'adding 3 items to the cart …',
  ].join('\n'),
}

const failed: DriveScenario = {
  file: SCENARIOS[1]!.file,
  name: SCENARIOS[1]!.name,
  status: 'failed',
  failure: {
    reason: 'exit',
    exitCode: 1,
    outputTail: [
      'seeding customer ana@example.com … ok',
      'creating coupons SPRING10, WELCOME5 …',
      'error: duplicate key value violates unique constraint "coupons_code_key"',
      '  at seedCoupons (.runcastle/scenarios/checkout/stacked-coupons.ts:41:11)',
    ].join('\n'),
  },
}

const serving = {
  featureId: FEATURE_ID,
  holderLabel: `the test drive of ${BRANCH}`,
  purpose: 'test-drive',
  branch: BRANCH,
  devPaneId: 'pane_dev',
  devUrl: SAMPLE_APP,
  devReady: true,
  devConfigured: true,
  state: 'serving',
} as unknown as SlotDrive

/** Made-up Select area crops. */
const crop = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="656" height="300" viewBox="0 0 656 300" font-family="system-ui" font-size="22"><rect width="656" height="300" fill="#f6f7f9"/>${body}</svg>`,
  )}`
const COUPON_SHOT = crop(
  '<rect x="24" y="24" width="608" height="252" rx="14" fill="#fff" stroke="#e3e6ea"/><text x="48" y="66" fill="#6e7781" font-size="18">Coupon</text><rect x="48" y="80" width="560" height="56" rx="8" fill="#fff" stroke="#c9ced4"/><text x="66" y="116" fill="#1f2328">SPRING10</text><text x="48" y="172" fill="#c92a2a" font-size="19">This coupon expired on 1 October.</text><text x="48" y="226" fill="#1f2328">Subtotal</text><text x="608" y="226" fill="#1f2328" text-anchor="end">$79.20</text><text x="48" y="256" fill="#c92a2a" font-size="17">10% still applied</text>',
)
const PAY_SHOT = crop(
  '<rect x="24" y="60" width="608" height="180" rx="14" fill="#fff" stroke="#e3e6ea"/><rect x="48" y="84" width="560" height="64" rx="8" fill="#3b5bdb"/><text x="328" y="125" fill="#fff" text-anchor="middle" font-weight="600">Pay $94.00</text><text x="48" y="196" fill="#6e7781" font-size="18">Checking coupon…</text>',
)

const MIN = 60_000
const base = { status: 'open' as const, createdAt: 0, updatedAt: 0 }

/** A feature's notes on the rail: two with pictures, one of words alone. */
export const FEATURE_NOTES = (now: number): TestNote[] => [
  { ...base, id: 'n1', featureId: FEATURE_ID, author: 'human', text: 'The total still shows the 10% discount for a moment after the coupon is refused.', screenshotUrl: COUPON_SHOT, createdAt: now - 4 * MIN },
  { ...base, id: 'n2', featureId: FEATURE_ID, author: 'human', text: 'Pay stays enabled while the coupon is being checked. You can pay at the old total.', screenshotUrl: PAY_SHOT, createdAt: now - 2 * MIN },
  { ...base, id: 'n3', featureId: FEATURE_ID, author: 'human', text: 'The error could say what to do next, not only that it expired.', createdAt: now - MIN },
]

/** The Orchestrator's notes: one from before this drive, the rest from it. */
export const PROJECT_NOTES = (now: number): ProjectNote[] => [
  { ...base, id: 'p1', projectId: 'proj_1', text: 'Order list takes four seconds with 300 orders and shows nothing while it loads.', createdAt: now - 26 * 60 * MIN },
  { ...base, id: 'p2', projectId: 'proj_1', text: 'Refund pending badge overlaps the order total on narrow screens.', screenshotUrl: COUPON_SHOT, driveBranch: 'main', driveCommit: 'a1b2c3d', createdAt: now - 6 * MIN },
]

/** One drive moment: what the server says, and which scenarios the project has. */
export interface DriveMoment {
  key: string
  label: string
  drive: SlotDrive | null
  scenarios: ScenarioEntry[]
  /** Open the scenario picker after load, to show the list. */
  pickerOpen?: boolean
  /** A rail with nothing in it yet. */
  noNotes?: boolean
}

export const DRIVE_MOMENTS: DriveMoment[] = [
  { key: 'landed', label: 'On a scenario', drive: { ...serving, scenario: landed }, scenarios: SCENARIOS },
  { key: 'picker', label: 'Picking a scenario', drive: { ...serving, scenario: landed }, scenarios: SCENARIOS, pickerOpen: true },
  { key: 'running', label: 'Scenario running', drive: { ...serving, scenario: running }, scenarios: SCENARIOS },
  { key: 'failed', label: 'Scenario failed', drive: { ...serving, scenario: failed }, scenarios: SCENARIOS },
  { key: 'blank', label: 'No scenarios or notes yet', drive: serving, scenarios: [], noNotes: true },
  {
    key: 'starting',
    label: 'Starting',
    drive: { ...serving, state: 'starting', devUrl: undefined, devReady: false } as SlotDrive,
    scenarios: SCENARIOS,
  },
  {
    key: 'setup-failed',
    label: 'Setup failed',
    drive: {
      ...serving,
      state: 'setup-failed',
      devPaneId: undefined,
      devUrl: undefined,
      hookFailure: {
        command: 'bun run db:reset && bun run seed',
        exitCode: 3,
        timedOut: false,
        output: 'error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)\nis the database container running?',
      },
    } as SlotDrive,
    scenarios: SCENARIOS,
  },
  {
    key: 'bare',
    label: 'Nothing started',
    drive: { ...serving, state: 'bare-checkout', devPaneId: undefined, devUrl: undefined, devConfigured: false } as SlotDrive,
    scenarios: SCENARIOS,
  },
  {
    key: 'agent',
    label: 'Review agent driving',
    drive: { ...serving, state: 'review-agent-driving', purpose: 'review' } as SlotDrive,
    scenarios: SCENARIOS,
  },
]

/** The project drive: the checkout as it is, belonging to no feature. */
export const PROJECT_DRIVE = {
  ...serving,
  featureId: undefined,
  projectDrive: true,
  projectId: 'proj_1',
  commit: 'a1b2c3d',
  startedAt: Date.now() - 12 * 60_000,
  holderLabel: 'a project drive of main',
  branch: 'main',
  scenario: { ...landed, file: SCENARIOS[11]!.file, name: SCENARIOS[11]!.name },
} as unknown as SlotDrive
