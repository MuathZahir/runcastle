// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchMenu, Dialog } from '../src/ui'

/**
 * The inline branch picker (decisions.md #3). Tier 2 rather than tier 1: the
 * whole of what is worth asserting — what the popover offers, what a pick sends,
 * that Escape closes it — only exists once the trigger has been clicked.
 *
 * The list is a `Combobox` now, so what the picker itself still owns is the only
 * thing tested here: which branches it offers, how it heads them, and the states
 * its props describe. The floating behaviour is the primitive's, and
 * `floating-primitives.test.tsx` holds it to that.
 */
describe('BranchMenu', () => {
  afterEach(cleanup)

  const BRANCHES = [
    'main',
    'develop',
    'feature/existing-work',
    'runcastle/project',
    'runcastle/ticket/foo/1-abc',
    'worktree-scratch',
    'afk/nightly',
  ]

  const open = (): void => {
    fireEvent.click(screen.getByRole('button', { expanded: false }))
  }

  const options = (): string[] => screen.getAllByRole('option').map((o) => o.textContent ?? '')

  it('offers only branches a human would land on', () => {
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={() => {}} />)
    open()

    expect(options()).toEqual(['main', 'develop', 'feature/existing-work'])
  })

  it('heads the detected main line off from the rest', () => {
    render(
      <BranchMenu
        prefix="landing on"
        value="develop"
        detected="main"
        branches={BRANCHES}
        onPick={() => {}}
      />,
    )
    open()

    expect(screen.getByText('Detected main line')).toBeTruthy()
    expect(screen.getByText('Other local branches')).toBeTruthy()
    expect(options()).toEqual(['main', 'develop', 'feature/existing-work'])
  })

  it('marks the current value and reports a pick once, then closes', () => {
    const onPick = vi.fn()
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={onPick} />)
    open()

    // `aria-current`, not `aria-selected`: cmdk owns the latter and spends it on
    // whichever row the keyboard is standing on.
    expect(screen.getByRole('option', { current: true }).textContent).toContain('main')
    fireEvent.click(screen.getByRole('option', { name: 'develop' }))

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('develop')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('commits a mouse pick and updates the controlled trigger', () => {
    function ControlledMenu() {
      const [branch, setBranch] = useState('main')
      return (
        <BranchMenu prefix="landing on" value={branch} branches={BRANCHES} onPick={setBranch} />
      )
    }

    render(<ControlledMenu />)
    open()
    // The pick lands in the popover's own portal, so nothing outside it can
    // unmount the row before the click arrives — the reason the hand-rolled menu
    // this replaced had to commit on `mousedown` instead.
    fireEvent.click(screen.getByRole('option', { name: 'develop' }))

    expect(screen.getByRole('button').textContent).toContain('landing on develop')
    open()
    expect(screen.getByRole('option', { current: true }).textContent).toContain('develop')
  })

  it('filters the branches as the search is typed', () => {
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={() => {}} />)
    open()

    fireEvent.change(screen.getByPlaceholderText('Find a branch…'), {
      target: { value: 'existing' },
    })

    expect(options()).toEqual(['feature/existing-work'])
  })

  it('moves through options with arrows and commits with Enter', () => {
    const onPick = vi.fn()
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={onPick} />)
    open()

    const search = screen.getByPlaceholderText('Find a branch…')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(onPick).toHaveBeenCalledWith('develop')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape without picking anything', async () => {
    const onPick = vi.fn()
    render(<BranchMenu prefix="from" value="main" branches={BRANCHES} onPick={onPick} />)
    const trigger = screen.getByRole('button', { expanded: false })
    open()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  // A form that cuts a branch can put this menu inside a Dialog, and both
  // answer Escape. One key must not close two things.
  it('answers Escape without the dialog it sits in also closing', () => {
    function InDialog() {
      const [dialogOpen, setDialogOpen] = useState(true)
      return (
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} label="Form">
          <BranchMenu prefix="from" value="main" branches={BRANCHES} onPick={() => {}} />
        </Dialog>
      )
    }
    render(<InDialog />)
    open()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('says the list is still in flight by refusing to open, not by claiming none', () => {
    render(<BranchMenu prefix="landing on" value={null} branches={undefined} onPick={() => {}} />)
    const trigger = screen.getByRole('button')

    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    expect(trigger.textContent).toContain('landing on …')
  })

  it('shows a repo with nothing to land on as an empty menu, not an empty page', () => {
    render(
      <BranchMenu
        prefix="from"
        value={null}
        branches={['runcastle/project']}
        onPick={() => {}}
        missing
      />,
    )
    open()

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('no branches to land on')).toBeTruthy()
  })

  it('paints the trigger in the warn colour when the branch is gone', () => {
    render(
      <BranchMenu prefix="landing on" value="gone" branches={BRANCHES} onPick={() => {}} missing />,
    )

    expect(screen.getByRole('button').className).toContain('text-warn')
  })
})
