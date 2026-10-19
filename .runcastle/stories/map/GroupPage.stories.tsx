import type { Meta, StoryObj } from '@storybook/react-vite'
import { MapGroupPage } from '../../../apps/web/src/components/map/MapGroupPage'
import { couponsGroup, mapModel, onboardingGroup } from '../../../apps/web/test/fixtures'

/**
 * One place's page: its states as whole-page pictures, one per row in step
 * order with step chips (frames load as they scroll in, three at a time — here
 * they point at a blank page), child places as sections, then Ways in and
 * Calls, each entry with its history line. A prop story — the model is the one
 * `project.map` answers.
 */
const noop = (): void => undefined

const meta = {
  title: 'Map/GroupPage',
  component: MapGroupPage,
  args: {
    model: mapModel(),
    group: couponsGroup(),
    build: { onBuild: noop, pending: false },
    onOpenGroup: noop,
    onOpenDrive: noop,
    onOpenFeature: noop,
  },
} satisfies Meta<typeof MapGroupPage>

export default meta
type Story = StoryObj<typeof meta>

export const AllThreeSections: Story = {}

export const AFlowOfSteps: Story = {
  args: { model: mapModel({ groups: [onboardingGroup()] }), group: onboardingGroup() },
}

export const ChildPlaces: Story = {
  args: {
    model: mapModel({
      groups: mapModel().groups.map((g) => (g.id === 'checkout' ? { ...g, pages: onboardingGroup().pages } : g)),
    }),
    group: { id: 'checkout', name: 'Checkout', pages: onboardingGroup().pages, scenarios: [] },
  },
}

export const OnlyWaysIn: Story = {
  args: {
    model: mapModel({ storiesSetUp: false, catalogue: { state: 'not_set_up', stale: false, building: false } }),
    group: couponsGroup({ pages: [], scenarios: couponsGroup().scenarios.slice(1) }),
  },
}

export const FailedCatalogue: Story = {
  args: {
    model: mapModel({
      catalogue: {
        state: 'never_built',
        stale: false,
        building: false,
        failure: {
          reason: 'stories.json exited 1',
          log: 'error: Could not resolve "./CouponField" from src/Checkout.stories.tsx',
          at: Date.now() - 600_000,
        },
      },
    }),
    group: couponsGroup({ pages: [] }),
  },
}
