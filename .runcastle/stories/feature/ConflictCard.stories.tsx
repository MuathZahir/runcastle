import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConflictCard } from '../../../apps/web/src/components/review/ConflictCard'

/** The review page's merge-conflict card: reached only by a merge that conflicts. */
const meta = {
  title: 'Feature/ConflictCard',
  component: ConflictCard,
  args: {
    branch: 'feature/greetings-pages',
    conflict: { base: 'main', files: ['index.html', 'src/App.tsx'], at: Date.now() - 3 * 60 * 60 * 1000 },
    readonly: false,
    liveSessionId: null,
    resolveEnded: false,
    busy: false,
    onResolve: () => undefined,
  },
} satisfies Meta<typeof ConflictCard>

export default meta
type Story = StoryObj<typeof meta>

export const MergeConflict: Story = {}

/** A chat is still open, and an earlier resolve came and went without landing. */
export const ResolveEndedWithSessionLive: Story = {
  args: { liveSessionId: 'ses_1', resolveEnded: true },
}
