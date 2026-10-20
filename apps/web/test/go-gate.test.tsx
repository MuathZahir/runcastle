// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { goSummary } from '../src/lib/feature-ui'
import { featureStatus, leadActions, OVERFLOW_KINDS } from '../src/lib/feature-ui/status-line'
import { GoConfirmation } from '../src/components/GoFeatureDialog'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

/**
 * Go follows a finished plan: before the tickets step is complete for this lap
 * the row's Go is disabled with the reason, and its override — Go anyway… —
 * opens the confirmation, which takes the one-line reason history records
 * (CONTEXT.md decision 8). Tier 2: the clicks and the typing are events.
 */
afterEach(cleanup)

const planBar: NextStep = { kick: 'PLAN', secondary: [{ label: 'Chat', kind: 'chat' }], busy: false }

function planningRow(ticketsReadyLap: number | null, onAction = vi.fn()) {
  const status = featureStatus({
    feature: { phase: 'planning', status: 'active', lap: 1, ticketsReadyLap, waitingReason: null },
    rounds: [],
    declarations: [],
    agentWorking: false,
    driving: false,
    selfPlanning: false,
    now: 0,
  })
  render(
    <NextStepBar
      ns={leadActions(planBar, status)}
      status={<FeatureStatusLine status={status} />}
      guidance={false}
      busy={false}
      onAction={onAction}
      demote={OVERFLOW_KINDS}
    />,
  )
  return onAction
}

const goButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Go$/ })

describe('Go on the planning row', () => {
  it('is disabled with the reason before the plan is finished, and Go anyway… takes the override', () => {
    const onAction = planningRow(null)

    expect(goButton().disabled).toBe(true)
    expect(screen.getByText('the plan is not finished')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Go anyway…' }))
    expect(onAction).toHaveBeenCalledWith('burn')
  })

  it('is enabled once the plan is finished, with no override offered', () => {
    const onAction = planningRow(1)

    expect(goButton().disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Go anyway…' })).toBeNull()
    fireEvent.click(goButton())
    expect(onAction).toHaveBeenCalledWith('burn')
  })
})

describe('Go’s confirmation as the gate’s override', () => {
  function confirmation(gate?: string, onConfirm = vi.fn()) {
    render(
      <GoConfirmation
        title="Greetings pages"
        branch="feature/greetings-pages"
        summary={goSummary({ branch: 'feature/greetings-pages', pendingTickets: [] })}
        busy={false}
        {...(gate ? { gate } : {})}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )
    return onConfirm
  }

  it('holds Go until a reason is typed, then sends it', () => {
    const onConfirm = confirmation('the plan is not finished')

    expect(goButton().disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(goButton().disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' the spec is in my head ' } })
    fireEvent.click(goButton())
    expect(onConfirm).toHaveBeenCalledWith('the spec is in my head')
  })

  it('asks for nothing when Go is not gated', () => {
    const onConfirm = confirmation()

    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(goButton())
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })
})
