// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Composer } from '../src/components/chat/thread/Composer'

/**
 * The composer's `@` and `/` lists (chat-as-web-components ticket 17): ranked
 * like a good fuzzy finder — prefix matches first, then word starts, then
 * letters scattered in order.
 */

afterEach(cleanup)

const COMMANDS = ['caveman-compress', 'clear', 'compact', 'recompute', 'context'].map((name) => ({ name, description: '' }))

function listed(value: string, files: string[] = []): string[] {
  render(<Composer value={value} onChange={() => {}} state="idle" onSend={() => {}} commands={COMMANDS} files={files} />)
  const list = screen.queryByRole('listbox')
  const options = list ? within(list).getAllByRole('option').map((o) => o.querySelector('span')?.textContent ?? o.textContent ?? '') : []
  cleanup()
  return options
}

describe('the composer search', () => {
  it('lists an exact prefix above a word-start match above a loose one', () => {
    expect(listed('/comp')).toEqual(['/compact', '/caveman-compress', '/recompute'])
  })

  it('finds files by scattered letters, the file name first', () => {
    const files = ['docs/threads/notes.md', 'apps/web/src/components/chat/thread/ThreadSwitcher.tsx', 'src/switch.ts']
    expect(listed('see @thsw', files)).toEqual(['apps/web/src/components/chat/thread/ThreadSwitcher.tsx'])
    expect(listed('see @switch', files)).toEqual(['src/switch.ts', 'apps/web/src/components/chat/thread/ThreadSwitcher.tsx'])
  })
})
