// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox, SegmentedControl, Switch } from '../src/ui'

/**
 * The choice primitives' behaviour — what a static render cannot show: arrow
 * keys moving *and* choosing in the segmented control, the roving tabindex
 * following the value, and the checkbox / switch reporting their new state.
 */
function Theme({ initial = 'dark' as 'dark' | 'light' | 'system' }) {
  const [value, setValue] = useState(initial)
  return (
    <SegmentedControl
      label="Theme"
      value={value}
      onChange={setValue}
      items={[
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'system', label: 'System' },
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  afterEach(cleanup)

  it('chooses a segment on click', () => {
    render(<Theme />)
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false')
  })

  it('moves and chooses with the arrow keys, wrapping, and Home/End', () => {
    render(<Theme />)
    const dark = screen.getByRole('radio', { name: 'Dark' })
    dark.focus()
    fireEvent.keyDown(dark, { key: 'ArrowRight' })
    const light = screen.getByRole('radio', { name: 'Light' })
    expect(light.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(light)
    expect(light.getAttribute('tabindex')).toBe('0')
    expect(dark.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(light, { key: 'End' })
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'ArrowRight' })
    expect(dark.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(dark, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('Checkbox and Switch', () => {
  afterEach(cleanup)

  it('reports the new state, and its label toggles it', () => {
    const seen: boolean[] = []
    render(<Checkbox checked={false} onChange={(v) => seen.push(v)} label="Quick fix" />)
    fireEvent.click(screen.getByText('Quick fix'))
    expect(seen).toEqual([true])
    expect(screen.getByRole('checkbox', { name: 'Quick fix' })).toBeTruthy()
  })

  it('flips a switch', () => {
    const seen: boolean[] = []
    render(<Switch checked onChange={(v) => seen.push(v)} aria-label="Sandbox" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Sandbox' }))
    expect(seen).toEqual([false])
  })
})
