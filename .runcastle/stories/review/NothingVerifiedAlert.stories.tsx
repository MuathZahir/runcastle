import type { Meta, StoryObj } from '@storybook/react-vite'
import { NothingVerifiedAlert } from '../../../apps/web/src/components/review/NothingVerifiedAlert'

/** A review pass that ran and verified nothing — no browser could attach. */
const meta = {
  title: 'Review/NothingVerifiedAlert',
  component: NothingVerifiedAlert,
  args: {
    outcome: {
      kind: 'unverified',
      line: 'Review pass #7 verified nothing: no drive was available.',
      reason: 'the browser could not attach to the dev server',
    },
    agenticReview: { onStart: () => undefined, blocked: 'A burn is already running on this feature.' },
  },
} satisfies Meta<typeof NothingVerifiedAlert>

export default meta
type Story = StoryObj<typeof meta>

export const NothingVerified: Story = {}
