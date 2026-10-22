// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { featureStatus, headerActions } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { HeaderAction } from '../src/components/workspace/HeaderAction'

/**
 * The planning header while the feature plans itself: the status line says so and
 * the header carries the run's Stop, never Go, so a click on Plan it yourself
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
  // The header row as the feature page composes it (design-mode decision 12).
  const row = headerActions(selfPlanning ? selfPlanBar : planBar, status)
  render(
    <header>
      <FeatureStatusLine status={status} />
      {row.action && <HeaderAction action={row.action} busy={false} onAction={onAction} />}
    </header>,
  )
  return { onAction, row }
}

describe('the planning header while the feature plans itself', () => {
  it('says Planning by itself and offers the run’s Stop, with no Go anywhere', () => {
    const { onAction, row } = planningRow(true)

    expect(screen.getByRole('status').textContent).toContain('Planning by itself')
    expect(row.go).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(onAction).toHaveBeenCalledWith('stopHeadlessRun')
  })

  it('reads Planning with you again once the run has ended, Go back on the tickets view', () => {
    const { row } = planningRow(false)

    expect(screen.getByRole('status').textContent).toContain('Planning with you')
    expect(screen.queryByText('Planning by itself')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Go|Stop)$/ })).toBeNull()
    expect(row.go?.label).toBe('Go')
  })
})
