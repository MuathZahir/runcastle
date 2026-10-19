import type { Meta, StoryObj } from '@storybook/react-vite'
import { MapGroupPage } from '../../../apps/web/src/components/map/MapGroupPage'
import { couponsGroup, mapModel } from '../../../apps/web/test/fixtures'

/**
 * One group's page: UI states (frames load as they scroll in — here they
 * point at a blank page), Ways in and Calls, each entry with its history line.
 * A prop story — the model is the one `project.map` answers.
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
