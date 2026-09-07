// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../src/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../src/ui/popover'
import { openMenu } from './floating'

/**
 * The floating primitives (feature: floating-primitives-via-shadcn-radix).
 * Tier 2, because none of what makes them worth adopting is visible in a
 * rendered string: the content is in a portal, the height cap is read off the
 * measured space, and Escape has to close the menu without taking the dialog
 * around it with it.
 */

describe('DropdownMenu', () => {
  afterEach(cleanup)

  function Harness({ onSelect = () => {} }: { onSelect?: () => void }) {
    return (
      // The ancestor that used to clip the menu: a ticket card whose own
      // overflow turned scrollable around a menu rendered inside it.
      <div className="overflow-hidden">
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
            <DropdownMenuItem tone="danger">Delete…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  it('renders its content in a portal, outside the overflow ancestor it opened in', () => {
    const { container } = render(<Harness />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    const menu = screen.getByRole('menu')
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
  })

  it('caps its height at the space Radix measured, and scrolls inside that', () => {
    render(<Harness />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('max-h-(--radix-dropdown-menu-content-available-height)')
    expect(menu.className).toContain('overflow-y-auto')
  })

  it('runs an item and closes', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(onSelect).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('gives a destructive item the danger colour', () => {
    render(<Harness />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    expect(screen.getByRole('menuitem', { name: 'Delete…' }).className).toContain('text-danger')
  })

  it('closes when a pointer lands outside it', async () => {
    render(<Harness />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    // Radix arms the outside-pointer listener a tick after opening, so that the
    // press which opened the menu cannot close it again on the way back up.
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and puts the focus back on its trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    openMenu(trigger)

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    // Radix defers the restore past the unmount, so this is the one assertion
    // in the file that cannot be made synchronously.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('answers Escape without closing the dialog it was opened inside', () => {
    function InDialog() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onClose={() => setOpen(false)} label="Settings">
          <DropdownMenu>
            <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Dialog>
      )
    }

    render(<InDialog />)
    openMenu(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('Popover', () => {
  afterEach(cleanup)

  function Harness() {
    return (
      <div className="overflow-hidden">
        <Popover>
          <PopoverTrigger>Pick a branch</PopoverTrigger>
          <PopoverContent>
            <p>main</p>
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  it('renders its panel in a portal, outside the overflow ancestor', () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a branch' }))

    const panel = screen.getByText('main').parentElement!
    expect(container.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
    expect(panel.className).toContain('max-h-(--radix-popover-content-available-height)')
  })

  it('closes on Escape', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a branch' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByText('main')).toBeNull()
  })
})
