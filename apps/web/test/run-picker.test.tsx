// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunPicker } from '../src/components/run/RunPicker'
import type { RunOption } from '../src/components/run/RunPicker'

/**
 * The run history's rows (decision #15b). Tier 2 because the list is the
 * `Select` primitive's portalled content, which a static render never emits;
 * the trigger's own markup is asserted in `run-record.test.ts`.
 */
const run = (over: Partial<RunOption> & { id: string }): RunOption => ({
  status: 'succeeded',
  startedAt: Date.now() - 3_600_000,
  endedAt: Date.now() - 3_000_000,
  lap: 1,
  ticketIds: ['t1', 't2'],
  ...over,
})

afterEach(cleanup)

describe('RunPicker rows', () => {
  it('names each run by age, state, lap and lane count, and marks the latest', () => {
    const onPick = vi.fn()
    render(
      <RunPicker
        runs={[
          run({ id: 'r3', lap: 2, ticketIds: ['t9'] }),
          run({ id: 'r2', status: 'failed' }),
          run({ id: 'r1', status: 'cancelled' }),
        ]}
        selectedId="r3"
        latestId="r3"
        onPick={onPick}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Run history' }))
    const list = screen.getByRole('listbox', { name: 'Run history' })
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0].textContent).toContain('Lap 2 · 1 lane')
    expect(options[0].textContent).toContain('latest')
    expect(options[1].textContent).toContain('Failed')
    expect(options[1].textContent).toContain('Lap 1 · 2 lanes')
    expect(options[2].textContent).toContain('Cancelled')

    fireEvent.click(options[1])
    expect(onPick).toHaveBeenCalledWith('r2')
  })
})
