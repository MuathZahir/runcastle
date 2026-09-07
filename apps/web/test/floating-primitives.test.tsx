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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../src/ui/select'
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

  it('answers Escape without closing the dialog it was opened inside', async () => {
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
    const trigger = screen.getByRole('button', { name: 'Actions' })
    openMenu(trigger)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    // The dialog answers Escape only when the focus is inside it, and the menu
    // takes the keystroke before it can travel that far — so the one press
    // closes the menu and nothing else.
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
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

describe('Select', () => {
  afterEach(cleanup)

  /** Long enough that the cap and the scroll are the only thing holding it in. */
  const roster = Array.from({ length: 40 }, (_, i) => `model-${i}`)

  /** The row the keyboard is on. Throws rather than asserting against `body`. */
  function activeOption(): HTMLElement {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active.getAttribute('role') !== 'option') {
      throw new Error(`focus is on ${active?.nodeName ?? 'nothing'}, not an option`)
    }
    return active
  }

  function Harness({
    value = '',
    onValueChange = () => {},
  }: {
    value?: string
    onValueChange?: (next: string) => void
  }) {
    return (
      // The ancestor that used to clip the menu: the ticket card whose own
      // overflow turned scrollable around the model chooser inside it.
      <div className="overflow-hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger aria-label="Ticket model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent aria-label="Ticket model options">
            <SelectItem value="">default (project model)</SelectItem>
            <SelectGroup>
              <SelectLabel>Claude Code</SelectLabel>
              {roster.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    )
  }

  it('renders its list in a portal, outside the overflow ancestor it opened in', () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Ticket model' }))

    const list = screen.getByRole('listbox', { name: 'Ticket model options' })
    expect(container.contains(list)).toBe(false)
    expect(document.body.contains(list)).toBe(true)
  })

  it('caps a long list at the space Radix measured, and scrolls inside that', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Ticket model' }))

    const list = screen.getByRole('listbox', { name: 'Ticket model options' })
    expect(screen.getAllByRole('option').length).toBe(roster.length + 1)
    expect(list.className).toContain('max-h-(--radix-select-content-available-height)')
    // Radix's own viewport is the scroller — `overflow: hidden auto`, inline.
    expect(list.querySelector('[data-radix-select-viewport]')).toBeTruthy()
  })

  it('reads the empty choice out in the closed trigger, and reports a pick', () => {
    const onValueChange = vi.fn()
    render(<Harness value="" onValueChange={onValueChange} />)

    const trigger = screen.getByRole('combobox', { name: 'Ticket model' })
    // Radix reads `''` as "nothing selected" and would show its placeholder;
    // the primitive's sentinel is what keeps the row's own text in the trigger.
    expect(trigger.textContent).toContain('default (project model)')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'model-3' }))
    expect(onValueChange).toHaveBeenLastCalledWith('model-3')
  })

  it('hands back an empty string when the empty row is picked', () => {
    const onValueChange = vi.fn()
    render(<Harness value="model-3" onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Ticket model' }))
    fireEvent.click(screen.getByRole('option', { name: 'default (project model)' }))

    expect(onValueChange).toHaveBeenLastCalledWith('')
  })

  it('opens on ArrowDown, moves with the arrows, and picks with Enter', async () => {
    const onValueChange = vi.fn()
    render(<Harness value="" onValueChange={onValueChange} />)

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Ticket model' }), { key: 'ArrowDown' })

    // Radix hands the focus to the chosen row, but only once the layer has been
    // placed — and it moves it between rows on a timeout — so every step of a
    // keyboard walk has to be waited for rather than asserted straight after.
    await waitFor(() => expect(activeOption().textContent).toContain('default (project model)'))
    fireEvent.keyDown(activeOption(), { key: 'ArrowDown' })
    await waitFor(() => expect(activeOption().textContent).toContain('model-0'))

    fireEvent.keyDown(activeOption(), { key: 'Enter' })
    expect(onValueChange).toHaveBeenLastCalledWith('model-0')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape and puts the focus back on its trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Ticket model' })
    fireEvent.click(trigger)

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('layers over a dialog it opened inside, and Escape closes only itself', async () => {
    function InDialog() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onClose={() => setOpen(false)} label="Settings">
          <Select value="" onValueChange={() => {}}>
            <SelectTrigger aria-label="Sandbox">
              <SelectValue />
            </SelectTrigger>
            <SelectContent aria-label="Sandbox options">
              <SelectItem value="">Use global (Docker)</SelectItem>
              <SelectItem value="noSandbox">No sandbox</SelectItem>
            </SelectContent>
          </Select>
        </Dialog>
      )
    }

    render(<InDialog />)
    const trigger = screen.getByRole('combobox', { name: 'Sandbox' })
    // The backdrop this has to float over, and the band that puts it there.
    expect(document.querySelector('.z-\\[200\\]')).toBeTruthy()

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox', { name: 'Sandbox options' }).className).toContain('z-[300]')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    // The dialog answers Escape only when the focus is inside it, and the list
    // takes the keystroke before it can travel that far.
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
