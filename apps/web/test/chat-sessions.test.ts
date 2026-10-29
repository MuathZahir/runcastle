import { describe, expect, it } from 'vitest'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { newestThread, scenarioChatLabel, standIn, withStandIns } from '../src/lib/chat-sessions'
import { projectViewLabel, projectViews } from '../src/lib/feature-ui/panel'

/**
 * The chat column's threads (chat-as-web-components decision 7): which thread
 * is a page's main chat, and the list its switcher offers.
 */
const entry = (id: string, role: ThreadEntry['role'], updatedAt: number): ThreadEntry => ({
  id,
  title: id,
  role,
  state: 'idle',
  createdAt: updatedAt,
  updatedAt,
  runtime: 'claude-code',
})

describe('the threads a page lists', () => {
  it('takes the newest thread of a role as its main chat, and none when there is none', () => {
    const threads = [entry('old', 'main', 1), entry('side', 'side', 9), entry('new', 'main', 5)]
    expect(newestThread(threads, 'main')).toBe('new')
    expect(newestThread(threads, 'prepare')).toBeNull()
  })

  it('names a thread the list does not hold yet, and never lists one twice', () => {
    const threads = [entry('th_main', 'main', 1)]
    const listed = withStandIns(threads, [standIn('th_main', 'Feature chat', 'main', 2), standIn('th_new', 'New thread', 'side', 2)])
    expect(listed.map((t) => [t.id, t.title])).toEqual([
      ['th_main', 'th_main'],
      ['th_new', 'New thread'],
    ])
  })

  it('names a scenario chat by its errand', () => {
    expect(scenarioChatLabel({ kind: 'new' })).toBe('Scenario chat · New scenario')
    expect(scenarioChatLabel({ kind: 'fix', name: 'Expired coupon' })).toBe('Scenario chat · Fix Expired coupon')
  })
})

describe('the project page’s panel', () => {
  it('offers the drive while one is up and the Notes inbox once there are notes', () => {
    expect(projectViews({ driveActive: false, hasNotes: false })).toEqual([])
    expect(projectViews({ driveActive: true, hasNotes: true })).toEqual(['drive', 'details'])
    expect(projectViewLabel('details')).toBe('Notes')
    expect(projectViewLabel('drive')).toBe('Drive')
  })
})
