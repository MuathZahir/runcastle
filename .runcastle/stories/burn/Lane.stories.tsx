import type { Meta, StoryObj } from '@storybook/react-vite'
import { Lane } from '../../../apps/web/src/components/run/Lane'

/** One ticket lane of a burn, in the state that needs the human: failed. */
const meta = {
  title: 'Burn/Lane',
  component: Lane,
  args: {
    ticket: {
      id: 't3',
      seq: 3,
      title: 'wire the settings pane',
      kind: 'implementation',
      status: 'failed',
      error: 'bun run typecheck failed: apps/web/src/components/SettingsOverlay.tsx(41,7): error TS2322',
      commits: ['4f1c2ab'],
    },
    featureBranch: 'feature/demo',
    readonly: false,
    expanded: false,
    hadOutput: true,
    duration: '14m',
    onToggle: () => undefined,
    onRetry: () => undefined,
    onWaive: () => undefined,
  },
} satisfies Meta<typeof Lane>

export default meta
type Story = StoryObj<typeof meta>

export const FailedTicket: Story = {}
