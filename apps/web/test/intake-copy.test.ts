// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateMenu } from '../src/components/Sidebar'
import { openMenu } from './floating'

/**
 * The intake copy, enforced. The Create menu used to describe the backlog door
 * as "Quick … no conversation"; the door is the backlog now, and an epic is the
 * only way work is born — from the epic list's dotted slot, its one way in
 * (epics-that-look-alive decision 5), so New epic is not in this menu. The
 * words are pinned here: prose drifts back, a rendering sweep does not.
 *
 * The Create menu's rows live in a portal that exists only while it is open,
 * hence the DOM.
 */

/** The Create menu, dropped open; returns each row's text. */
function createRows(): string[] {
  render(createElement(CreateMenu, { onDraft: () => undefined, onOpenNote: () => undefined }))
  openMenu(screen.getByRole('button', { name: 'Create' }))
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
}

describe('the Create menu', () => {
  afterEach(cleanup)

  it('has no New epic: the dotted slot atop the epic list is the one way in', () => {
    const rows = createRows()
    expect(rows.some((r) => /New epic/.test(r))).toBe(false)
    expect(rows.map((r) => r.split(/(?=[A-Z][a-z])/)[0])).toHaveLength(2)
  })

  it('offers the backlog as a place to park an idea, not a shortcut past the chat', () => {
    const rows = createRows()
    expect(rows[0]).toBe('Add to backlogWrite an idea down now, work it out later')
    expect(rows[1]).toMatch(/^Jot a note/)
  })

  it('describes no door as Quick', () => {
    for (const row of createRows()) expect.soft(row).not.toMatch(/\bQuick\b/)
  })
})
