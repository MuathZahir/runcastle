// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadItem } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { WorkBlock } from '../src/components/chat/thread/Work'

/**
 * A turn with every word in view (every-word-the-agent-writes-stays-in-view
 * decisions 3, 9, 10): each stretch of words copies itself, the turn's last
 * words copy the whole turn and alone carry Branch, the model and the turn's
 * time; a run that is only thinking is one "Thought for" fold.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const TURN: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: 'Fix the export.' },
  { kind: 'agent', id: 'a1', text: 'Looking at the export first.', model: 'Opus 5.5' },
  { kind: 'work', id: 'w1', seconds: 46, steps: [{ kind: 'tools', id: 't1', calls: [{ id: 'c1', kind: 'read', title: 'Read src/export.ts', status: 'completed' }] }] },
  { kind: 'agent', id: 'a2', text: 'Fixed: the body is parsed now.', model: 'Opus 5.5', turnSeconds: 171 },
]

function renderTurn(items: ThreadItem[] = TURN) {
  render(<ChatThread items={items} state="idle" actions={{ onEdit: () => {}, onBranch: () => {}, canUndoFiles: true }} footer={null} />)
}

/** The agent message that says `text`, to look for its own hover actions. */
const message = (text: string) => within(screen.getByText(text).closest('.group\\/msg') as HTMLElement)

describe('a turn with several stretches of words', () => {
  it('shows every stretch in order, the run between them folded with its own time', () => {
    renderTurn()
    expect(screen.getByText('Looking at the export first.')).toBeTruthy()
    expect(screen.getByText('Fixed: the body is parsed now.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Worked for 46s/ })).toBeTruthy()
  })

  it('offers Branch, the model and the turn time only on the last words', () => {
    renderTurn()
    const first = message('Looking at the export first.')
    const last = message('Fixed: the body is parsed now.')
    expect(first.queryByRole('button', { name: 'Branch into a new chat from here' })).toBeNull()
    expect(first.queryByText(/Opus 5.5/)).toBeNull()
    expect(first.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(last.getByRole('button', { name: 'Branch into a new chat from here' })).toBeTruthy()
    expect(last.getByText('Opus 5.5 · 2m 51s')).toBeTruthy()
  })

  it('copies one stretch from an earlier message, and the whole turn from the last words', () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderTurn()
    fireEvent.click(message('Looking at the export first.').getByRole('button', { name: 'Copy' }))
    fireEvent.click(message('Fixed: the body is parsed now.').getByRole('button', { name: 'Copy' }))
    expect(writeText.mock.calls).toEqual([['Looking at the export first.'], ['Looking at the export first.\n\nFixed: the body is parsed now.']])
  })
})

describe('a run that is only thinking', () => {
  it('folds to one "Thought for" line that opens straight to the thought', () => {
    render(<WorkBlock seconds={5} steps={[{ kind: 'thought', id: 'th1', seconds: 4, text: 'Render the sample note.' }]} />)
    expect(screen.queryByText(/Worked for/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Thought for 5s/ }))
    expect(screen.getByText('Render the sample note.')).toBeTruthy()
  })
})
