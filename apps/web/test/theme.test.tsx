// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from '../src/ui'

/**
 * The theme (lib/theme.ts): a stored preference painted onto `<html
 * data-theme>` before the first render, following the OS while it is `system`.
 * Tier 2, because what it does is touch the document, storage and a media query.
 *
 * The module keeps the current preference in module state, so every test
 * imports a fresh copy.
 */

/** A `prefers-color-scheme: light` query this test can flip. */
function fakeMedia(initiallyLight: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: initiallyLight,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    flip(light: boolean) {
      media.matches = light
      for (const fn of listeners) fn()
    },
    listeners,
  }
}

async function freshTheme() {
  vi.resetModules()
  return import('../src/lib/theme')
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('theme', () => {
  it('paints dark when nothing is stored', async () => {
    fakeMedia(true)
    const theme = await freshTheme()
    expect(theme.applyStoredTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('paints the stored preference, and ignores a value it does not know', async () => {
    fakeMedia(false)
    localStorage.setItem('runcastle.theme', 'light')
    expect((await freshTheme()).applyStoredTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    localStorage.setItem('runcastle.theme', 'sepia')
    expect((await freshTheme()).applyStoredTheme()).toBe('dark')
  })

  it('follows the OS while the preference is system, and stops when it is not', async () => {
    const media = fakeMedia(false)
    localStorage.setItem('runcastle.theme', 'system')
    const theme = await freshTheme()
    theme.applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    media.flip(true)
    expect(document.documentElement.dataset.theme).toBe('light')

    theme.setThemePreference('dark')
    expect(media.listeners.size).toBe(0)
    media.flip(false)
    media.flip(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('remembers a choice, and still applies it when storage throws', async () => {
    fakeMedia(false)
    const theme = await freshTheme()
    theme.setThemePreference('light')
    expect(localStorage.getItem('runcastle.theme')).toBe('light')

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => theme.setThemePreference('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
    vi.restoreAllMocks()
  })

  it('gives a toggle the preference, what is painted, and a flip', async () => {
    fakeMedia(true)
    localStorage.setItem('runcastle.theme', 'system')
    const theme = await freshTheme()
    theme.applyStoredTheme()

    function Toggle() {
      const { preference, resolved, toggle } = theme.useTheme()
      return (
        <button type="button" onClick={toggle}>
          {preference}:{resolved}
        </button>
      )
    }
    render(<Toggle />)
    expect(screen.getByRole('button').textContent).toBe('system:light')

    // A system preference flips to the explicit opposite of what is painted.
    act(() => fireEvent.click(screen.getByRole('button')))
    expect(screen.getByRole('button').textContent).toBe('dark:dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('runcastle.theme')).toBe('dark')
  })
})

describe('Tabs keyboard', () => {
  function Harness() {
    const [value, setValue] = useState('overview')
    return (
      <Tabs
        label="Views"
        value={value}
        onChange={setValue}
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'tickets', label: 'Tickets', disabled: true },
          { id: 'activity', label: 'Activity' },
        ]}
      />
    )
  }

  it('moves to and selects a neighbour with the arrows, skipping disabled tabs, and Home/End jump', () => {
    render(<Harness />)
    const tab = (name: string) => screen.getByRole('tab', { name })
    tab('Overview').focus()

    fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' })
    expect(tab('Activity').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Activity'))

    fireEvent.keyDown(tab('Activity'), { key: 'ArrowRight' })
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tab('Overview'), { key: 'End' })
    expect(tab('Activity').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Activity'), { key: 'Home' })
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true')
    expect(tab('Overview').tabIndex).toBe(0)
    expect(tab('Activity').tabIndex).toBe(-1)
  })
})
