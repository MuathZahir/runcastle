// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoticeStrip } from '../src/components/chat/NoticeStrip'
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
  target: 'work',
  count: 3,
  eventId: 1,
}

describe('word peers', () => {
  afterEach(cleanup)

  it('gives a chat notice its glyph in the hue and leaves its words neutral', () => {
    render(<NoticeStrip notices={[TICKETS]} onAct={() => {}} onDismiss={() => {}} />)

    expect(classes(screen.getByRole('button', { name: 'View tickets' }))).not.toContain('text-phase-tickets-text')
    const glyph = screen.getByRole('article').querySelector('[data-phase="tickets"]')!.parentElement
    expect(classes(glyph)).toContain('text-phase-tickets')
    expect(classes(glyph)).not.toContain('text-phase-tickets-text')
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
