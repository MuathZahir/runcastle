import type { Meta, StoryObj } from '@storybook/react-vite'
import { UnrunnableGates } from '../../../apps/web/src/components/run/UnrunnableGates'

/** A burn whose sandbox lacked what a verify command needed. */
const meta = {
  title: 'Burn/UnrunnableGates',
  component: UnrunnableGates,
  args: {
    gates: [
      { command: 'cargo test --workspace', error: 'sh: 1: cargo: not found' },
      { command: 'docker compose run --rm api pytest', error: 'docker: command not found' },
    ],
  },
} satisfies Meta<typeof UnrunnableGates>

export default meta
type Story = StoryObj<typeof meta>

export const MissingRuntime: Story = {}
