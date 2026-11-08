// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarFeatureRow } from '../src/components/SidebarParts'
import { TooltipProvider } from '../src/ui/tooltip'
import { listItem } from './fixtures'

/** The arrow on a feature's sidebar row (clicking-a-feature-opens-its-lead decisions 2, 4, 5, 6). */
describe('the workers arrow on a feature row', () => {
  afterEach(cleanup)

  const row = (workers?: { live: number; onOpen: () => void }, onSelect = vi.fn()) =>
    render(
      <TooltipProvider>
        <SidebarFeatureRow f={listItem({ id: 'feat_1', title: 'Demo' } as never)} active={false} onSelect={onSelect} actions={[]} {...(workers ? { workers } : {})} />
      </TooltipProvider>,
    )

  it('is drawn only when the row is given one', () => {
    row()
    expect(screen.queryByRole('button', { name: /^Workers/ })).toBeNull()
  })

  it('shows how many workers are in play, and a bare chevron when none are', () => {
    row({ live: 3, onOpen: () => {} })
    expect(screen.getByRole('button', { name: 'Workers · 3 working or waiting' }).textContent).toBe('3')
    cleanup()
    row({ live: 0, onOpen: () => {} })
    expect(screen.getByRole('button', { name: 'Workers' }).textContent).toBe('')
  })

  it('opens the workers page without also opening the row', () => {
    const onOpen = vi.fn()
    const onSelect = vi.fn()
    row({ live: 1, onOpen }, onSelect)
    fireEvent.click(screen.getByRole('button', { name: /^Workers/ }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('never takes a colour, even on a row whose worker needs you', () => {
    render(
      <TooltipProvider>
        <SidebarFeatureRow f={listItem({ id: 'feat_1' } as never)} active={false} onSelect={() => {}} actions={[]} needsYou workers={{ live: 2, onOpen: () => {} }} />
      </TooltipProvider>,
    )
    const arrow = screen.getByRole('button', { name: /^Workers/ })
    expect(arrow.className).not.toMatch(/warning|danger|accent/)
  })
})
