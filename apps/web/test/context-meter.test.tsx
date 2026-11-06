// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextMeter } from '../src/components/chat/thread/ComposerParts'

/**
 * The meter colours by the context's size, not by how full the window is
 * (honest-token-counts decision 8): every message re-reads the whole context,
 * so cost starts to hurt at a size, whatever the model's window.
 */
afterEach(cleanup)

function meter(used: number, size: number) {
  render(<ContextMeter context={{ used, size }} limits={[]} onCompact={() => {}} />)
  const trigger = screen.getByRole('button', { name: /^Context \d+% used$/ })
  const number = trigger.querySelector(':scope > span:last-child') as HTMLElement
  return { trigger, number }
}

describe('the context meter', () => {
  it.each([
    [150_000, 1_000_000, '150k', 'quiet'],
    [250_000, 1_000_000, '250k', 'warning'],
    [450_000, 1_000_000, '450k', 'danger'],
    [180_000, 200_000, '180k', 'danger'],
  ])('at %i of a %i window shows %s, %s', (used, size, label, tone) => {
    const { number } = meter(used, size)
    expect(number.textContent).toBe(label)
    expect(number.className.includes('text-warning')).toBe(tone === 'warning')
    expect(number.className.includes('text-danger')).toBe(tone === 'danger')
  })

  it('says why in the popover only once the context costs', () => {
    const line = /re-reads the whole context/
    const quiet = meter(150_000, 1_000_000)
    fireEvent.click(quiet.trigger)
    expect(screen.getByText(/150k of 1M · 15%/)).toBeTruthy()
    expect(screen.queryByText(line)).toBeNull()
    cleanup()

    fireEvent.click(meter(250_000, 1_000_000).trigger)
    expect(screen.getByText(line)).toBeTruthy()
  })
})
