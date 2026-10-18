// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StopAgentDialog } from '../src/components/workspace/FeatureStatusLine'

/**
 * Stop's confirmation (`the-feature-lead-runs-rounds` decision 23). Tier 2: a
 * portalled dialog and its clicks are events, which a rendered string cannot show.
 */
afterEach(cleanup)

describe('Stop', () => {
  it('asks once, says nothing starts until you reply, then stops', () => {
    const onStop = vi.fn()
    const onClose = vi.fn()
    render(<StopAgentDialog open onStop={onStop} onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Stop the agent?' })
    expect(dialog.textContent).toContain('nothing new starts until you reply')
    expect(dialog.textContent).not.toMatch(/Ask before each round|autonomy/i)

    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Stop')!
    fireEvent.click(confirm)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps going when the human thinks better of it', () => {
    const onStop = vi.fn()
    const onClose = vi.fn()
    render(<StopAgentDialog open onStop={onStop} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }))

    expect(onStop).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while closed', () => {
    render(<StopAgentDialog open={false} onStop={() => undefined} onClose={() => undefined} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
