// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PathCrumbs } from '../src/components/PathCrumbs'

/**
 * The half of the merged control a rendered string cannot show (decision 6):
 * the crumb strip turning into a field, and what the two keys that leave it do.
 * Escape is the interesting one — the dialog around this control closes on the
 * same key, so the edit has to answer first and the dialog second.
 */

const onNavigate = vi.fn()
const onEnterPath = vi.fn()

function show(value = '/home/you/code') {
  return render(
    <PathCrumbs
      crumbs={[
        { name: '/', path: '/' },
        { name: 'home', path: '/home' },
        { name: 'you', path: '/home/you' },
        { name: 'code', path: '/home/you/code' },
      ]}
      value={value}
      onNavigate={onNavigate}
      onEnterPath={onEnterPath}
      placeholder="/path/to/your/repo"
    />,
  )
}

const field = () => screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement
const strip = () => screen.getByRole('group', { name: 'Current path' })

describe('PathCrumbs editing', () => {
  beforeEach(() => {
    onNavigate.mockClear()
    onEnterPath.mockClear()
  })
  afterEach(cleanup)

  it('turns into a field pre-filled with the current path when clicked', () => {
    show()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(strip())

    expect(field().value).toBe('/home/you/code')
    expect(screen.queryByRole('group', { name: 'Current path' })).toBeNull()
  })

  it('pre-fills whatever the picker handed it, not only where it is', () => {
    // After the picker walks up from a path that is not there, the value is
    // still what the user typed — that is the thing worth correcting.
    show('/home/you/code/typo')
    fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))

    expect(field().value).toBe('/home/you/code/typo')
  })

  it('hands a typed path over on Enter, trimmed, as a claim rather than a crumb', () => {
    // Not `onNavigate`: nothing has said this path exists, and the picker owes
    // it the walk-up a crumb never needs.
    show()
    fireEvent.click(strip())
    fireEvent.change(field(), { target: { value: '  /var/tmp  ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onEnterPath).toHaveBeenCalledWith('/var/tmp')
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('reverts to the crumbs on Escape without letting the key reach the dialog', () => {
    // The dialog listens on `window`, so "does the dialog stay open" is exactly
    // "did this keydown get that far".
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    try {
      show()
      fireEvent.click(strip())
      fireEvent.change(field(), { target: { value: '/nonsense' } })
      fireEvent.keyDown(field(), { key: 'Escape' })

      expect(onWindowKey).not.toHaveBeenCalled()
      expect(strip()).toBeTruthy()
      expect(onEnterPath).not.toHaveBeenCalled()

      // The second Escape is the dialog's — nothing here is listening for it now.
      fireEvent.keyDown(strip(), { key: 'Escape' })
      expect(onWindowKey).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })

  it('abandons the edit when the field loses the focus', () => {
    show()
    fireEvent.click(strip())
    fireEvent.change(field(), { target: { value: '/nonsense' } })
    fireEvent.blur(field())

    expect(strip()).toBeTruthy()
    expect(onEnterPath).not.toHaveBeenCalled()
  })

  it('navigates from a crumb without opening the field under it', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'home' }))

    expect(onNavigate).toHaveBeenCalledWith('/home')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
