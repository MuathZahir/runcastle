import type { Meta, StoryObj } from '@storybook/react-vite'
import { RoundTrail } from '../../../apps/web/src/components/review/RoundTrail'
import type { TrailTicket } from '../../../apps/web/src/lib/feature-ui/rounds'

/** The sample data of `apps/web/test/round-trail-view.test.ts`, which keeps it inline. */
const worker = (seq: number, status: string): TrailTicket => ({
  id: `t${seq}`,
  seq,
  title: `pricing: task ${seq}`,
  status,
})

/**
 * A feature on its second round: the earlier round with a failed worker, the
 * agent's own fix and a "Ready for you" after it, the new round still running —
 * only reached after a whole round has burned.
 */
const meta = {
  title: 'Review/RoundTrail',
  component: RoundTrail,
  args: {
    trail: {
      entries: [
        {
          type: 'round',
          round: 1,
          runId: 'r1',
          status: 'succeeded',
          workers: [worker(1, 'done'), worker(2, 'done'), worker(3, 'failed')],
          landed: 2,
          failed: 1,
          gates: { ok: true, failed: [] },
          durationMs: 18 * 60_000,
          verdict: 'Pricing landed; the totals worker failed on a fixture.',
        },
        {
          type: 'agent-fix',
          commits: [{ sha: 'abc1234def5678', subject: 'feat(pricing): rename the total field' }],
          files: ['a.ts', 'b.ts'],
        },
        {
          type: 'ready',
          scenario: 'Apply a coupon at checkout',
          whatToTest: 'Add two items, apply SAVE10, check the total.',
          afterRound: 1,
        },
        {
          type: 'round',
          round: 2,
          runId: 'r2',
          status: 'running',
          workers: [worker(4, 'burning')],
          landed: 0,
          failed: 0,
          gates: null,
          durationMs: null,
          verdict: null,
        },
      ],
      notDispatched: [worker(5, 'pending')],
    },
  },
} satisfies Meta<typeof RoundTrail>

export default meta
type Story = StoryObj<typeof meta>

export const AfterAnEarlierRound: Story = {}
