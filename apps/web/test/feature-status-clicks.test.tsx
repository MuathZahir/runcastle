// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'

/**
 * The status line's two controls (`the-feature-lead-runs-rounds` decisions 1
 * and 15). Tier 2: a switch that writes and a Stop that asks first are events
 * and a portalled dialog, which a rendered string cannot show.
 */
afterEach(cleanup)

const working = { kind: 'working', label: 'Working · Round 2', round: 2 } as const

describe('the autonomy switch', () => {
  it('writes the other option, and nothing for the one already held', () => {
    const onAutonomy = vi.fn()
    render(
      <FeatureStatusLine status={working} autonomy="run-until-ready" onAutonomy={onAutonomy} onStop={() => undefined} />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Run until ready' }))
    expect(onAutonomy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: 'Ask before each round' }))
    expect(onAutonomy).toHaveBeenCalledWith('ask')
  })
})

describe('Stop', () => {
  it('asks once, then stops', () => {
    const onStop = vi.fn()
    render(<FeatureStatusLine status={working} autonomy="run-until-ready" onAutonomy={() => undefined} onStop={onStop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Stop the agent?' })
    expect(dialog.textContent).toContain('Ask before each round')

    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Stop')!
    fireEvent.click(confirm)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps going when the human thinks better of it', () => {
    const onStop = vi.fn()
    render(<FeatureStatusLine status={working} autonomy="ask" onAutonomy={() => undefined} onStop={onStop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }))

    expect(onStop).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
