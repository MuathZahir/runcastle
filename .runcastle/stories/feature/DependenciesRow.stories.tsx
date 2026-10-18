import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { DependenciesRow } from '../../../apps/web/src/components/workspace/FeatureDependencies'
import { listItem } from '../../../apps/web/test/fixtures'

type DependencyRef = ComponentProps<typeof DependenciesRow>['dependsOn'][number]

const dep = (slug: string, over: Partial<DependencyRef> = {}): DependencyRef => ({
  featureId: `feat_${slug}`,
  slug,
  title: `The ${slug} feature`,
  phase: 'building',
  status: 'active',
  satisfied: false,
  ...over,
})

/** A draft that waits on features still being built, one archived, one merged. */
const meta = {
  title: 'Feature/DependenciesRow',
  component: DependenciesRow,
  args: {
    isDraft: true,
    dependsOn: [
      dep('auth'),
      dep('billing', { status: 'archived', phase: 'planning' }),
      dep('base', { status: 'shipped', phase: 'shipped', satisfied: true }),
    ],
    candidates: [{ ...listItem({ id: 'feat_search', slug: 'search', phase: 'planning' }), title: 'Search' }],
    onChange: async () => undefined,
  },
} satisfies Meta<typeof DependenciesRow>

export default meta
type Story = StoryObj<typeof meta>

export const WaitingOnDependencies: Story = {}
