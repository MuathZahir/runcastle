// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseSelect } from '../src/components/BaseSelect'
import type { BranchList } from '../src/lib/api'

/**
 * The base-branch picker (decision 8). Tier 2: what it is worth holding this
 * component to — which branches it offers, and that the "choose a branch…" state
 * is a thing said and never a thing pickable — is only visible once the list is
 * open.
 */
describe('BaseSelect', () => {
  afterEach(cleanup)

  const BRANCHES: BranchList = {
    current: 'main',
    detected: 'main',
    branches: ['main', 'develop'],
    remoteBranches: ['origin/release'],
  }

  function Harness({
    branches,
    initial = 'main',
    onPick,
  }: {
    /** Left off deliberately by the in-flight case — `undefined` is that state. */
    branches?: BranchList
    initial?: string
    onPick?: (base: string) => void
  }) {
    const [base, setBase] = useState(initial)
    return (
      <BaseSelect
        id="base"
        label="Base"
        branches={branches}
        value={base}
        hint="the feature forks from here"
        onPick={(next) => {
          setBase(next)
          onPick?.(next)
        }}
      />
    )
  }

  const open = (): void => {
    fireEvent.click(screen.getByLabelText('Base'))
  }

  it('offers the local branches and heads the remote-only ones off', () => {
    render(<Harness branches={BRANCHES} />)
    open()

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'main (current)',
      'develop',
      'origin/release',
    ])
    expect(screen.getByText('Remote (creates a local branch)')).toBeTruthy()
  })

  it('picks a base and shows it on the closed control', () => {
    const onPick = vi.fn()
    render(<Harness branches={BRANCHES} onPick={onPick} />)
    open()

    fireEvent.click(screen.getByRole('option', { name: 'develop' }))

    expect(onPick).toHaveBeenCalledWith('develop')
    expect(screen.getByLabelText('Base').textContent).toContain('develop')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('searches the list rather than making a long one be scrolled', () => {
    render(<Harness branches={BRANCHES} />)
    open()

    fireEvent.change(screen.getByPlaceholderText('Find a branch…'), {
      target: { value: 'release' },
    })

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['origin/release'])
  })

  it('says a checkout with no usable base has to be answered, and blocks nothing else', () => {
    render(<Harness branches={BRANCHES} initial="" />)

    expect(screen.getByLabelText('Base').textContent).toContain('choose a branch…')
    expect(screen.getByText(/not a branch a feature can fork from/)).toBeTruthy()
  })

  it('never offers the empty state as something to pick, before or after a choice', () => {
    render(<Harness branches={BRANCHES} initial="" />)
    open()

    // The trigger says "choose a branch…"; the list holds branches only, so the
    // state a form blocks on cannot be re-entered by picking it back.
    expect(screen.queryByRole('option', { name: /choose a branch/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'develop' }))
    open()
    expect(screen.queryByRole('option', { name: /choose a branch/ })).toBeNull()
  })

  it('refuses to open while the list is still in flight, and says which state that is', () => {
    render(<Harness initial="" />)

    const trigger = screen.getByLabelText('Base') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain('loading…')
  })

  it('refuses to open a repo with no branches at all', () => {
    render(
      <Harness branches={{ current: '', detected: '', branches: [], remoteBranches: [] }} initial="" />,
    )

    expect((screen.getByLabelText('Base') as HTMLButtonElement).disabled).toBe(true)
  })
})
