import type { Meta, StoryObj } from '@storybook/react-vite'
import { MapOverview } from '../../../apps/web/src/components/map/MapOverview'
import { mapModel } from '../../../apps/web/test/fixtures'

/**
 * The map with no group selected: the tree of places, each with a picture of
 * its first state and its tally, main's catalogue line, and each situation
 * where a part of the map is missing. A prop story — the model is the one
 * `project.map` answers.
 */
const noop = (): void => undefined
const full = mapModel()
const notSetUp = { state: 'not_set_up', stale: false, building: false } as const

const meta = {
  title: 'Map/Overview',
  component: MapOverview,
  args: {
    model: full,
    build: { onBuild: noop, pending: false },
    doors: { onSetUpStories: noop, onNewScenario: noop },
    onOpenGroup: noop,
  },
} satisfies Meta<typeof MapOverview>

export default meta
type Story = StoryObj<typeof meta>

export const Both: Story = {}

export const NoStories: Story = {
  args: {
    model: {
      storiesSetUp: false,
      catalogue: notSetUp,
      groups: full.groups.map((g) => ({ ...g, pages: [] })),
    },
  },
}

export const NoPages: Story = {
  args: { model: mapModel({ groups: full.groups.map((g) => ({ ...g, pages: [] })) }) },
}

export const NoScenarios: Story = {
  args: { model: mapModel({ groups: full.groups.map((g) => ({ ...g, scenarios: [] })) }) },
}

export const Neither: Story = {
  args: { model: { storiesSetUp: false, catalogue: notSetUp, groups: [] } },
}

export const NeverBuilt: Story = {
  args: {
    model: mapModel({
      catalogue: { state: 'never_built', stale: false, building: false },
      groups: full.groups.map((g) => ({ ...g, pages: [] })),
    }),
  },
}

export const Stale: Story = {
  args: {
    model: mapModel({ catalogue: { ...full.catalogue, builtAt: Date.now() - 3 * 86_400_000, stale: true } }),
  },
}

export const Failed: Story = {
  args: {
    model: mapModel({
      catalogue: {
        ...full.catalogue,
        failure: {
          reason: 'stories.json exited 1',
          log: 'vite v7.1.0 building for production...\nerror: Could not resolve "./CouponField" from src/Checkout.stories.tsx',
          at: Date.now() - 600_000,
        },
      },
    }),
  },
}
