// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHONE_QUERY, useIsPhone } from '../src/lib/use-phone'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches: initial,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  }
  const matchMedia = vi.fn(() => list)
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    matchMedia,
    set(matches: boolean) {
      list.matches = matches
      listeners.forEach((f) => f())
    },
  }
}

function Probe() {
  return <span data-testid="probe">{useIsPhone() ? 'phone' : 'desktop'}</span>
}

describe('useIsPhone', () => {
  it('follows the phone query as the screen turns', () => {
    const media = stubMedia(true)
    render(<Probe />)
    expect(media.matchMedia).toHaveBeenCalledWith(PHONE_QUERY)
    expect(screen.getByTestId('probe').textContent).toBe('phone')
    act(() => media.set(false))
    expect(screen.getByTestId('probe').textContent).toBe('desktop')
  })

  it('is the desktop app where the browser cannot say', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('desktop')
  })
})
