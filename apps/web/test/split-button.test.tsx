// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SplitButton } from '../src/ui'
import { DropdownMenuItem, DropdownMenuLabel } from '../src/ui/dropdown-menu'
import { openMenu } from './floating'

/**
 * The split button (drive-scenarios decision 7): one click stays one click on
 * the main half, and the caret opens the choices. Tier 2, because the menu is a
 * portal that only exists once Radix has seen the pointer down.
 */
describe('SplitButton', () => {
  afterEach(cleanup)

  function renderSplit(props: { disabled?: boolean; loading?: boolean } = {}) {
    const onDefault = vi.fn()
    const onPick = vi.fn()
    render(
      <SplitButton
        variant="primary"
        onClick={onDefault}
        menuLabel="Choose a scenario"
        menu={
          <>
            <DropdownMenuLabel>This feature</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onPick('expired')}>Expired coupon</DropdownMenuItem>
          </>
        }
        {...props}
      >
        Test drive · Expired coupon
      </SplitButton>,
    )
    return { onDefault, onPick }
  }

  it('runs the default on the main click without opening the menu', () => {
    const { onDefault, onPick } = renderSplit()

    fireEvent.click(screen.getByRole('button', { name: 'Test drive · Expired coupon' }))

    expect(onDefault).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu from the caret and runs the item picked', () => {
    const { onDefault, onPick } = renderSplit()

    openMenu(screen.getByRole('button', { name: 'Choose a scenario' }))
    expect(screen.getByRole('menu').textContent).toContain('This feature')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expired coupon' }))

    expect(onPick).toHaveBeenCalledWith('expired')
    expect(onDefault).not.toHaveBeenCalled()
  })

  it('disables both halves when disabled, and both while loading', () => {
    renderSplit({ disabled: true })
    expect(screen.getByRole('button', { name: 'Test drive · Expired coupon' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Choose a scenario' }).hasAttribute('disabled')).toBe(true)
    cleanup()

    renderSplit({ loading: true })
    expect(screen.getByRole('button', { name: 'Choose a scenario' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByRole('button')[0]?.getAttribute('aria-busy')).toBe('true')
  })

  it('rounds only the outer corners of each half', () => {
    renderSplit()
    expect(screen.getByRole('button', { name: 'Test drive · Expired coupon' }).className).toContain('rounded-l-md')
    expect(screen.getByRole('button', { name: 'Choose a scenario' }).className).toContain('rounded-r-md')
  })
})
