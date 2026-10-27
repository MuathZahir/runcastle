// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { featureStatus, headerActions } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { HeaderAction } from '../src/components/workspace/HeaderAction'

/**
 * The header while the feature plans itself: the status line says so and the
 * header carries the run's Stop, so a click on Plan it yourself visibly did
 * something. Tier 2: Stop's click reaching the dispatcher is an event, which a
 * rendered string cannot show.
 */
afterEach(cleanup)

/** What the resolver offers while a self-planning run is live (`next-step/headless.ts`). */
const selfPlanBar: NextStep = {
  kick: 'PLANNING ITSELF',
  title: 'Planning itself',
  desc: 'Planning by itself — open the thread to watch; the plan appears below as it is written.',
  primary: { label: 'Stop', kind: 'stopSelfPlan' },
  secondary: [],
  busy: true,
}

/** What it offers once the run has ended: the plain step. */
const plainBar: NextStep = { kick: 'NEXT STEP', secondary: [], busy: false }

function headerRow(selfPlanning: boolean, onAction = vi.fn()) {
  const status = featureStatus({
    feature: { status: 'active', waitingReason: null },
    rounds: [],
    declarations: [],
    agentWorking: false,
    driving: false,
    selfPlanning,
    now: 0,
  })
  // The header row as the feature page composes it (design-mode decision 12).
  const row = headerActions(selfPlanning ? selfPlanBar : plainBar, status)
  render(
    <header>
      <FeatureStatusLine status={status} />
      {row.action && <HeaderAction action={row.action} busy={false} onAction={onAction} />}
    </header>,
  )
  return { onAction, row }
}

describe('the header while the feature plans itself', () => {
  it('says Planning by itself and offers the run’s Stop', () => {
    const { onAction } = headerRow(true)

    expect(screen.getByRole('status').textContent).toContain('Planning by itself')

    fireEvent.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(onAction).toHaveBeenCalledWith('stopSelfPlan')
  })

  it('reads Talking with you once the run has ended, with no Go and no button', () => {
    const { row } = headerRow(false)

    expect(screen.getByRole('status').textContent).toContain('Talking with you')
    expect(screen.queryByText('Planning by itself')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(row.overflow.map((a) => a.label)).toEqual(['Merge & ship'])
  })
})
