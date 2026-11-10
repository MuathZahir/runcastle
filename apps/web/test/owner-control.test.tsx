// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureActionsMenu } from '../src/components/FeatureActionsMenu'
import { OwnerStrip } from '../src/components/chat/OwnerStrip'
import { OwnerChoices, OwnerControl, type FeatureOwner } from '../src/components/workspace/OwnerControl'
import { TooltipProvider } from '../src/ui/tooltip'
import { openMenu } from './floating'

/**
 * The owner control's menu and the row menu's owner choices (every-feature-has-one-owner
 * decisions 11, 21), and the owner strip's link (decision 28). Tier 2: the
 * menu exists only once Radix has portalled it open.
 */

const CHAT = 'Notes triage'

function renderControl(owner: FeatureOwner, opts: { chatName?: string; planning?: boolean } = {}) {
  const onChoose = vi.fn()
  render(
    <TooltipProvider>
      <OwnerControl owner={owner} {...opts} feature="Export notes as PDF" onChoose={onChoose} />
    </TooltipProvider>,
  )
  return onChoose
}

const checked = () =>
  screen
    .getAllByRole('menuitemradio')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent)

describe('OwnerControl', () => {
  afterEach(cleanup)

  it('checks the chat choice in force, and choosing "I\'ll finish it" takes the feature', () => {
    const onChoose = renderControl({ kind: 'chat', name: CHAT, finish: 'merge' }, { chatName: CHAT })
    openMenu(screen.getByRole('button', { name: /Notes triage · merges it/ }))
    expect(screen.getAllByRole('menuitemradio').map((item) => item.querySelector('.text-text')?.textContent)).toEqual([
      "I'll finish it",
      `${CHAT} builds it and shows me before merging`,
      `${CHAT} builds and merges it`,
    ])
    expect(checked()).toHaveLength(1)
    expect(checked()[0]).toContain(`${CHAT} builds and merges it`)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /I'll finish it/ }))
    expect(onChoose).toHaveBeenCalledWith('you')
  })

  it('checks "I\'ll finish it" on a feature the human owns, and gives it to the chat on a chat choice', () => {
    const onChoose = renderControl({ kind: 'you' }, { chatName: CHAT })
    openMenu(screen.getByRole('button', { name: 'Yours' }))
    expect(checked()[0]).toContain("I'll finish it")
    fireEvent.click(screen.getByRole('menuitemradio', { name: /shows me before merging/ }))
    expect(onChoose).toHaveBeenCalledWith('show')
  })

  it('marks the chat choice that takes effect at the plan yes while the human grills it', () => {
    renderControl({ kind: 'chat', name: CHAT, finish: 'show' }, { chatName: CHAT, planning: true })
    openMenu(screen.getByRole('button', { name: /Yours to plan · then Notes triage/ }))
    expect(checked()[0]).toContain('shows me before merging')
  })

  it('does not open with no chat, and says how to hand it to one on hover', async () => {
    renderControl({ kind: 'you' })
    expect(screen.queryByRole('button')).toBeNull()
    const control = document.querySelector<HTMLElement>('[data-owner-control]')!
    expect(control.textContent).toBe('Yours')
    // A keyboard focus shows the hover's words (Radix opens a tooltip on a focus no pointer caused).
    fireEvent.focus(control)
    expect((await screen.findAllByText(/run “Export notes as PDF” for me/)).length).toBeGreaterThan(0)
    fireEvent.pointerDown(control, { button: 0 })
    fireEvent.click(control)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('the row menu', () => {
  afterEach(cleanup)

  it('puts the owner choices above the actions, the held one checked', () => {
    const onChoose = vi.fn()
    render(
      <FeatureActionsMenu
        actions={[{ key: 'copy-link', label: 'Copy link', onSelect: () => {} }]}
        choices={<OwnerChoices current="show" chat={CHAT} onChoose={onChoose} />}
      />,
    )
    openMenu(screen.getByRole('button', { name: 'Feature actions' }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(checked()[0]).toContain('shows me before merging')
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /builds and merges it/ }))
    expect(onChoose).toHaveBeenCalledWith('merge')
  })

  it('offers no owner choices for a feature with no chat', () => {
    render(<FeatureActionsMenu actions={[{ key: 'copy-link', label: 'Copy link', onSelect: () => {} }]} />)
    openMenu(screen.getByRole('button', { name: 'Feature actions' }))
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  })
})

describe('OwnerStrip', () => {
  afterEach(cleanup)

  it('opens the chat that owns the feature from its link', () => {
    const onOpenChat = vi.fn()
    render(<OwnerStrip chat={CHAT} asking={false} onOpenChat={onOpenChat} />)
    expect(screen.getByRole('note', { name: 'Who runs this feature' }).textContent).toContain(
      `${CHAT} runs this feature. Sending makes it yours.`,
    )
    fireEvent.click(screen.getByRole('button', { name: `Open ${CHAT}` }))
    expect(onOpenChat).toHaveBeenCalledOnce()
  })
})
