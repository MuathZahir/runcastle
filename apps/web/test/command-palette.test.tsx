// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '../src/components/CommandPalette'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { Dialog } from '../src/ui'

const nav: ProjectNavApi = {
  projects: [],
  loading: false,
  view: 'project',
  currentProjectId: 'project-1',
  currentProject: undefined,
  goHome: vi.fn(),
  enterProject: vi.fn(),
  showOpen: vi.fn(),
  cancelOpen: vi.fn(),
}

describe('CommandPalette', () => {
  afterEach(cleanup)

  it('closes above Settings without passing Escape through to the dialog', () => {
    function Harness() {
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [paletteOpen, setPaletteOpen] = useState(false)
      return (
        <>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} label="Settings">
            <button onClick={() => setPaletteOpen(true)}>Open palette</button>
          </Dialog>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            features={[]}
            selectedFeatureId={null}
            onSelect={vi.fn()}
            onOpenSettings={vi.fn()}
            onOpenPreparation={vi.fn()}
            onOpenProjectChat={vi.fn()}
            nav={nav}
          />
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }))
    const escapedToWindow = vi.fn()
    window.addEventListener('keydown', escapedToWindow)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(escapedToWindow).not.toHaveBeenCalled()
    window.removeEventListener('keydown', escapedToWindow)
  })

  /**
   * The three labeled groups are drawn separately but index into one flat row
   * list, so ↑ from the first row has to land on the last ACTION — the group
   * boundaries are arithmetic over that list, not three keyboardable lists.
   */
  it('wraps from the first row up to the last action and activates it', () => {
    const showOpen = vi.fn()
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        features={[]}
        selectedFeatureId={null}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenPreparation={vi.fn()}
        onOpenProjectChat={vi.fn()}
        nav={{ ...nav, showOpen }}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(showOpen).toHaveBeenCalledOnce()
  })
})
