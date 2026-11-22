import { describe, expect, it } from 'vitest'
import { inProgressSiblings, type SiblingRow } from '../src/services/epic-siblings'

/**
 * The siblings a merge's news lists (`the-epic-hears-when-its-features-merge`
 * decision 6): the epic's other started features. Every merge wakes the epic
 * now (`autopilot-retires` decision 2); the list only says what is in progress.
 */

function row(id: string, overrides: Partial<SiblingRow> = {}): SiblingRow {
  return { id, slug: id, title: id, status: 'active', chatId: 'epic', ...overrides }
}

describe('inProgressSiblings', () => {
  const merged = { id: 'merged', chatId: 'epic' }

  it('counts the epic’s other started features', () => {
    const rows = [row('merged'), row('a'), row('b'), row('c')]
    expect(inProgressSiblings(rows, merged).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('leaves out drafts, shipped and archived features, and the merged one itself', () => {
    const rows = [
      row('merged', { status: 'shipped' }),
      row('draft', { status: 'draft' }),
      row('shipped', { status: 'shipped' }),
      row('archived', { status: 'archived' }),
    ]
    expect(inProgressSiblings(rows, merged)).toEqual([])
  })

  it('leaves out another epic’s features and features with no epic', () => {
    const rows = [row('theirs', { chatId: 'other' }), row('none', { chatId: null })]
    expect(inProgressSiblings(rows, merged)).toEqual([])
  })

  it('finds nothing for a merged feature with no epic', () => {
    expect(inProgressSiblings([row('a', { chatId: null })], { id: 'merged', chatId: null })).toEqual([])
  })
})
