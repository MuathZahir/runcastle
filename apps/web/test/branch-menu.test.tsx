// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchMenu, Dialog } from '../src/ui'

/**
 * The inline branch picker (decisions.md #3). Tier 2 rather than tier 1: the
 * whole of what is worth asserting — what the popover offers, what a pick sends,
 * that Escape closes it — only exists once the trigger has been clicked.
 */
describe('BranchMenu', () => {
  afterEach(cleanup)

  const BRANCHES = [
    'main',
    'develop',
    'runcastle/project',
    'runcastle/ticket/foo/1-abc',
    'worktree-scratch',
    'afk/nightly',
  ]

  const open = (): void => {
    fireEvent.click(screen.getByRole('button', { expanded: false }))
  }

  const options = (): string[] =>
    screen.getAllByRole('option').map((o) => o.textContent?.replace('✓', '') ?? '')

  it('offers only branches a human would land on', () => {
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={() => {}} />)
    open()

    expect(options()).toEqual(['main', 'develop'])
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
    expect(options()).toEqual(['main', 'develop'])
  })

  it('marks the current value and reports a pick once, then closes', () => {
    const onPick = vi.fn()
    render(<BranchMenu prefix="landing on" value="main" branches={BRANCHES} onPick={onPick} />)
    open()

    expect(screen.getByRole('option', { selected: true }).textContent).toContain('main')
    fireEvent.click(screen.getByRole('option', { name: 'develop' }))

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('develop')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape without picking anything', () => {
    const onPick = vi.fn()
    render(<BranchMenu prefix="from" value="main" branches={BRANCHES} onPick={onPick} />)
    open()
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
  })

  // The Quick footer and the draft bar put this menu inside a Dialog, and both
  // answer Escape. One key must not close two things.
  it('answers Escape without the dialog it sits in also closing', () => {
    function InDialog() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onClose={() => setOpen(false)} label="Quick">
          <BranchMenu prefix="from" value="main" branches={BRANCHES} onPick={() => {}} />
        </Dialog>
      )
    }
    render(<InDialog />)
    open()
    fireEvent.keyDown(window, { key: 'Escape' })

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
