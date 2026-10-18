// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UiStatesSection } from '../src/components/review/UiStatesSection'
import type { UiStatesModel, UiStatesStory } from '../src/lib/api'
import { BASE_FRAME, FEATURE_FRAME, uiStatesModel } from './fixtures'

/**
 * The "UI states" section's two behaviours a string cannot show (tier 2): the
 * far matches' line opens and closes, and "Open larger" brings one story up
 * full-size in the app's dialog.
 */
/** A frame URL that loads nothing: happy-dom really fetches an iframe's `src`. */
const blank = (url: string): string => url.replace('http://localhost:4514', 'about:blank#')

function offline(model: UiStatesModel): UiStatesModel {
  const swap = (s: UiStatesStory): UiStatesStory => ({
    ...s,
    frameUrl: blank(s.frameUrl),
    baseFrameUrl: s.baseFrameUrl && blank(s.baseFrameUrl),
  })
  return {
    ...model,
    changed: model.changed.map(swap),
    new: model.new.map(swap),
    affected: model.affected.map(swap),
  }
}

describe('UiStatesSection interactions', () => {
  afterEach(cleanup)

  it('opens and closes the collapsed far-match line', () => {
    const { container } = render(<UiStatesSection model={offline(uiStatesModel())} currentLap={1} />)
    const details = container.querySelector('details')
    if (!details) throw new Error('no collapsed line')
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByText('2 more stories use changed code'))
    expect(details.open).toBe(true)
    fireEvent.click(screen.getByText('2 more stories use changed code'))
    expect(details.open).toBe(false)
  })

  it("opens the frame's own story full-size, and closes it", () => {
    render(<UiStatesSection model={offline(uiStatesModel({ affected: [] }))} currentLap={1} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const buttons = screen.getAllByRole('button', { name: 'Open larger' })
    // Before, This feature (the changed pair), then the new story's one frame.
    expect(buttons).toHaveLength(3)

    fireEvent.click(buttons[0] as HTMLElement)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Checkout / Coupon field · Expired')).toBeTruthy()
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe(
      blank(`${BASE_FRAME}checkout-coupon--expired&viewMode=story`),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(buttons[2] as HTMLElement)
    expect(screen.getByRole('dialog').querySelector('iframe')?.getAttribute('src')).toBe(
      blank(`${FEATURE_FRAME}checkout-coupon--expiring&viewMode=story`),
    )
  })

  it('opens a far match full-size from its row', () => {
    render(<UiStatesSection model={offline(uiStatesModel({ changed: [], new: [] }))} currentLap={1} />)
    fireEvent.click(screen.getByText('2 more stories use changed code'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Open larger' })[1] as HTMLElement)
    expect(screen.getByRole('dialog').querySelector('iframe')?.getAttribute('src')).toBe(
      blank(`${FEATURE_FRAME}cart-drawer--discount&viewMode=story`),
    )
  })
})
