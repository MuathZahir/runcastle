// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyWorkspace } from '../src/components/ProjectShell'
import { CreateMenu } from '../src/components/Sidebar'
import { openMenu } from './floating'

/**
 * The intake copy, enforced. Both doors are one click apart on two surfaces —
 * the sidebar's Create menu and the project with nothing selected — and each
 * surface used to describe the second door as "Quick … no conversation". The
 * door is Draft now, and New is the only way work is born, so the words are
 * pinned here: prose drifts back, a rendering sweep does not.
 *
 * The Create menu's rows live in a portal that exists only while it is open,
 * hence the DOM; the empty project is plain markup.
 */

/** The Create menu, dropped open; returns each row's text. */
function createRows(): string[] {
  render(createElement(CreateMenu, { onNewChat: () => undefined, onDraft: () => undefined }))
  openMenu(screen.getByRole('button', { name: 'Create' }))
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
}

/** The project with nothing selected, where the same two doors are said again. */
function home(): string {
  return renderToStaticMarkup(
    createElement(EmptyWorkspace, {
      projectName: 'Project',
      onNewChat: () => undefined,
      onDraft: () => undefined,
    }),
  )
}

describe('the two intake doors', () => {
  afterEach(cleanup)

  it('sends features and quick changes through the conversation, on both surfaces', () => {
    const [newChat] = createRows()
    expect(newChat).toMatch(/^New chat.*quick changes.+burn-ready tickets/)
    expect(home()).toMatch(/New is the door for both features and quick changes/)
  })

  it('offers the second door as a place to park an idea, not a shortcut past the chat', () => {
    const rows = createRows()
    expect(rows[1]).toBe('Draft an ideaWrite an idea down now, work it out later')

    const html = home()
    expect(html).toMatch(/<button[^>]*>(<span[^>]*>.*?<\/span>)?Draft<\/button>/)
    expect(html).toMatch(/Draft writes an idea down now, to work out later/)
  })

  it('describes no door as Quick on either surface', () => {
    // Lower-case "quick changes" is the kind of work New takes, not a door.
    for (const row of createRows()) expect.soft(row).not.toMatch(/\bQuick\b/)
    expect(home()).not.toMatch(/\bQuick\b/)
  })
})
