// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { featureStatus, leadActions, OVERFLOW_KINDS } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

/**
 * The planning row while the feature plans itself: the status line says so and
 * the row carries the run's Stop, never Go, so a click on Plan it yourself
 * visibly did something. Tier 2: Stop's click reaching the dispatcher is an
 * event, which a rendered string cannot show.
 */
afterEach(cleanup)

/** What the resolver offers while a self-planning run is live (`next-step/headless.ts`). */
const selfPlanBar: NextStep = {
  kick: 'PLANNING ITSELF',
  title: 'Planning itself',
  desc: 'No terminal to watch; the plan appears below as it is written.',
  primary: { label: 'Stop', kind: 'stopHeadlessRun' },
  secondary: [],
  busy: true,
}

/** What it offers once the run has ended and the plan waits on the human. */
const planBar: NextStep = { kick: 'PLAN', primary: { label: 'Burn 3 tickets', kind: 'burn' }, secondary: [], busy: false }

function planningRow(selfPlanning: boolean, onAction = vi.fn()) {
  const status = featureStatus({
    feature: { phase: 'planning', status: 'active', lap: 1, ticketsReadyLap: null, waitingReason: null },
    rounds: [],
    declarations: [],
    agentWorking: false,
    driving: false,
    selfPlanning,
    now: 0,
  })
  render(
    <NextStepBar
      ns={leadActions(selfPlanning ? selfPlanBar : planBar, status)}
      status={<FeatureStatusLine status={status} />}
      guidance={false}
      busy={false}
      onAction={onAction}
      demote={OVERFLOW_KINDS}
    />,
  )
  return onAction
}

describe('the planning row while the feature plans itself', () => {
  it('says Planning by itself and offers the run’s Stop, not Go', () => {
    const onAction = planningRow(true)

    expect(screen.getByRole('status').textContent).toContain('Planning by itself')
    expect(screen.queryByRole('button', { name: /^Go$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(onAction).toHaveBeenCalledWith('stopHeadlessRun')
  })

  it('reads Planning with you again once the run has ended', () => {
    planningRow(false)

    expect(screen.getByRole('status').textContent).toContain('Planning with you')
    expect(screen.queryByText('Planning by itself')).toBeNull()
    expect(screen.getByRole('button', { name: /^Go$/ })).toBeTruthy()
  })
})
