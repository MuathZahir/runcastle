// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateMenu } from '../src/components/Sidebar'
import { openMenu } from './floating'

/**
 * The intake copy, enforced. Both doors sit in the sidebar's Create menu (the
 * "pick a feature" page that repeated them is gone — a project with nothing
 * selected is the project home now), and the menu used to describe the second
 * door as "Quick … no conversation". The door is Draft now, and New is the only
 * way work is born, so the words are pinned here: prose drifts back, a
 * rendering sweep does not.
 *
 * The Create menu's rows live in a portal that exists only while it is open,
 * hence the DOM.
 */

/** The Create menu, dropped open; returns each row's text. */
function createRows(): string[] {
  render(createElement(CreateMenu, { onNewChat: () => undefined, onDraft: () => undefined }))
  openMenu(screen.getByRole('button', { name: 'Create' }))
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
}

describe('the two intake doors', () => {
  afterEach(cleanup)

  it('sends features and quick changes through the conversation', () => {
    const [newChat] = createRows()
    expect(newChat).toMatch(/^New chat.*quick changes.+burn-ready tickets/)
  })

  it('offers the second door as a place to park an idea, not a shortcut past the chat', () => {
    const rows = createRows()
    expect(rows[1]).toBe('Draft an ideaWrite an idea down now, work it out later')
  })

  it('describes no door as Quick', () => {
    // Lower-case "quick changes" is the kind of work New takes, not a door.
    for (const row of createRows()) expect.soft(row).not.toMatch(/\bQuick\b/)
  })
})
