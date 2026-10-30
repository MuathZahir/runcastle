// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationsPage, conversationGroup } from '../src/components/project/ConversationsPage'
import type { ThreadEntry } from '../src/lib/chat-thread'

/**
 * The Conversations page (the-orchestrator-s-page decisions 6, 7, 12, 19): every
 * chat of the project, Active first, then by the day of last activity.
 */

const NOW = new Date(2026, 9, 30, 15, 0, 0).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const chat = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: 'sess_1',
  title: 'Read the audit handoff',
  role: 'project',
  state: 'idle',
  createdAt: NOW - 3 * HOUR,
  updatedAt: NOW - 3 * HOUR,
  runtime: 'claude-code',
  ...over,
})

const opened: string[] = []
const mount = (threads: ThreadEntry[]) => render(<ConversationsPage threads={threads} onOpen={(id) => opened.push(id)} now={NOW} />)
/** The groups on the page, top to bottom, each with its rows' titles. */
const groups = () =>
  screen.getAllByRole('region').map((g) => [g.getAttribute('aria-label'), within(g).getAllByRole('button').map((b) => b.title)])

afterEach(() => {
  cleanup()
  opened.length = 0
})

describe('conversationGroup', () => {
  const at = (updatedAt: number) => conversationGroup({ state: 'idle', updatedAt }, NOW)
  const midnight = new Date(2026, 9, 30).getTime()

  it('files an idle chat by the calendar day of its last activity', () => {
    expect(at(midnight)).toBe('Today')
    expect(at(midnight - 1)).toBe('Yesterday')
    expect(at(midnight - DAY)).toBe('Yesterday')
    expect(at(midnight - DAY - 1)).toBe('This week')
    expect(at(midnight - 6 * DAY)).toBe('This week')
    expect(at(midnight - 6 * DAY - 1)).toBe('This month')
    expect(at(midnight - 29 * DAY)).toBe('This month')
    expect(at(midnight - 29 * DAY - 1)).toBe('Earlier')
  })

  it('keeps a live chat Active whatever its age', () => {
    expect(conversationGroup({ state: 'working', updatedAt: NOW - 40 * DAY }, NOW)).toBe('Active')
    expect(conversationGroup({ state: 'waiting', updatedAt: NOW - 40 * DAY }, NOW)).toBe('Active')
  })
})

describe('ConversationsPage', () => {
  it('lists Active first, waiting before working, then the dates, newest first, leaving empty groups out', () => {
    mount([
      chat({ id: 'a', title: 'Old', updatedAt: NOW - 40 * DAY }),
      chat({ id: 'b', title: 'Older today', updatedAt: NOW - 3 * HOUR }),
      chat({ id: 'c', title: 'Newer today', updatedAt: NOW - HOUR }),
      chat({ id: 'd', title: 'Busy', state: 'working', updatedAt: NOW - 60_000 }),
      chat({ id: 'e', title: 'Asking', state: 'waiting', updatedAt: NOW - 2 * DAY }),
    ])
    expect(groups()).toEqual([
      ['Active', ['Asking', 'Busy']],
      ['Today', ['Newer today', 'Older today']],
      ['Earlier', ['Old']],
    ])
  })

  it('says what each chat is doing, and counts them under the title', () => {
    mount([chat({ id: 'q', state: 'waiting' }), chat({ id: 'w', state: 'working' }), chat({ id: 'i' })])
    const rows = groups()
    expect(rows).toHaveLength(2)
    const text = document.body.textContent ?? ''
    expect(text).toContain('3 conversations')
    expect(text).toContain('1 waiting for you')
    expect(text).toContain('1 working')
    expect(screen.getByTitle('Waiting for you')).toBeTruthy()
    expect(text).toContain('3h')
  })

  it('leaves the counts of nothing out', () => {
    mount([chat()])
    const text = document.body.textContent ?? ''
    expect(text).toContain('1 conversation')
    expect(text).not.toContain('working')
    expect(text).not.toContain('waiting')
  })

  it('narrows every group to the filter and marks the match, keeping the counts of the whole', () => {
    mount([chat({ id: 'a', title: 'Plan the audit' }), chat({ id: 'b', title: 'Audit journal', updatedAt: NOW - 40 * DAY }), chat({ id: 'c', title: 'Other' })])
    fireEvent.change(screen.getByLabelText('Filter conversations'), { target: { value: 'audit' } })
    expect(groups()).toEqual([
      ['Today', ['Plan the audit']],
      ['Earlier', ['Audit journal']],
    ])
    expect([...document.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['audit', 'Audit'])
    expect(document.body.textContent).toContain('3 conversations')
  })

  it('says when nothing matches, and Escape clears the filter', () => {
    mount([chat()])
    const field = screen.getByLabelText('Filter conversations') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'zzz' } })
    expect(screen.getByText('No conversation matches')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field.value).toBe('')
    expect(screen.getByTitle('Read the audit handoff')).toBeTruthy()
  })

  it('opens a chat from its row', () => {
    mount([chat({ id: 'th_1' })])
    fireEvent.click(screen.getByTitle('Read the audit handoff'))
    expect(opened).toEqual(['th_1'])
  })

  it('says a project with no chats has none', () => {
    mount([])
    expect(screen.getByText('No conversations yet')).toBeTruthy()
    expect(screen.queryAllByRole('region')).toEqual([])
  })
})
