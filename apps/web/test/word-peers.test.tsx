// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoticeDeck } from '../src/components/chat/NoticeDeck'
import { PHASE_NAME } from '../src/icons'
import type { ChatNotice } from '../src/lib/chat-notices'
import { Field } from '../src/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../src/ui/dropdown-menu'
import { openMenu } from './floating'

/**
 * Words wear a hue's `-text` peer; marks keep the hue (DESIGN.md §Colour,
 * feature lighten-the-light-theme-s-colours). Tier 2: the split is read off
 * the class lists of the elements that carry the words and the glyphs.
 */
function classes(el: Element | null): string[] {
  return (el?.getAttribute('class') ?? '').split(/\s+/)
}

const TICKETS: ChatNotice = {
  kind: 'tickets',
  hue: 'tickets',
  title: 'Tickets updated',
  subtitle: 'ticket 3 cancelled',
  actionLabel: 'View tickets',
  target: 'body',
  count: 3,
  eventId: 1,
}

describe('word peers', () => {
  afterEach(cleanup)

  it('gives a chat notice card its words in the peer and its glyphs in the hue', () => {
    render(<NoticeDeck notices={[TICKETS]} onAct={() => {}} onDismiss={() => {}} />)
    fireEvent.mouseEnter(screen.getByRole('status'))

    expect(classes(screen.getByText(PHASE_NAME.tickets))).toContain('text-phase-tickets-text')
    expect(classes(screen.getByLabelText('3 times'))).toContain('text-phase-tickets-text')
    const action = screen.getByRole('button', { name: 'View tickets' })
    expect(classes(action)).toContain('text-phase-tickets-text')
    expect(classes(action)).not.toContain('text-phase-tickets')
    expect(classes(action.querySelector('svg'))).toContain('text-phase-tickets')

    const chip = screen.getByRole('article').querySelector('[data-phase="tickets"]')!.parentElement
    expect(classes(chip)).toContain('text-phase-tickets')
    expect(classes(chip)).not.toContain('text-phase-tickets-text')
  })

  it('gives a danger menu item its label in the peer and its icon in the hue', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem tone="danger">Delete…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    openMenu(screen.getByRole('button', { name: 'Actions' }))

    const item = classes(screen.getByRole('menuitem', { name: 'Delete…' }))
    expect(item).toContain('text-danger-text')
    expect(item).toContain('[&_svg]:text-danger')
    expect(item).not.toContain('text-danger')
  })

  it('paints a field error in the danger peer', () => {
    render(
      <Field label="Base branch" error="Pick a branch.">
        <input />
      </Field>,
    )

    const error = classes(screen.getByRole('alert'))
    expect(error).toContain('text-danger-text')
    expect(error).not.toContain('text-danger')
  })
})
