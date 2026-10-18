import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { CarriedFindings } from '../../../apps/web/src/components/review/CarriedFindings'

type ReviewFinding = ComponentProps<typeof CarriedFindings>['findings'][number]

const carried = (over: Partial<ReviewFinding> & { id: string }): ReviewFinding => ({
  featureId: 'feat_1',
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'medium',
  title: 'the toast never dismisses',
  location: 'apps/web/src/lib/toast.tsx:20',
  citation: 'spec.md §Toasts',
  detail: 'The timer is cleared by the re-render before it fires.',
  reproStep: 'Save twice and watch the first toast.',
  status: 'carried',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  carriedLap: 2,
  resolvedBy: null,
  resolutionNote: null,
  createdAt: 10,
  ...over,
})

/** Defects an earlier lap parked into a later one: only reached after two laps. */
const meta = {
  title: 'Review/CarriedFindings',
  component: CarriedFindings,
  args: {
    featureId: 'feat_1',
    readonly: false,
    findings: [
      carried({ id: 'find_1', resolutionNote: 'lap 2 is rebuilding the toast host' }),
      carried({ id: 'find_2', lap: 2, carriedLap: 3, severity: 'high', title: 'the drawer traps focus' }),
    ],
  },
} satisfies Meta<typeof CarriedFindings>

export default meta
type Story = StoryObj<typeof meta>

export const CarriedIntoLaterLaps: Story = {}
