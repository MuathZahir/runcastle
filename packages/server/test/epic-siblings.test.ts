import { describe, expect, it } from 'vitest'
import { inProgressSiblings, mergeWakesEpic, type SiblingRow } from '../src/services/epic-siblings'

/**
 * The wake test (`the-epic-hears-when-its-features-merge` decisions 2, 5, 6, 9):
 * the merged feature's epic wakes only while another of its features is started,
 * and not when the epic merged it itself.
 */

function row(id: string, overrides: Partial<SiblingRow> = {}): SiblingRow {
  return { id, slug: id, title: id, status: 'active', chatId: 'epic', heldBy: null, ...overrides }
}

describe('inProgressSiblings', () => {
  const merged = { id: 'merged', chatId: 'epic' }

  it('counts the epic’s other started features, whoever owns them', () => {
    const rows = [row('merged'), row('a'), row('b', { heldBy: 'epic' }), row('c', { heldBy: 'other' })]
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

describe('mergeWakesEpic', () => {
  it('wakes the epic for the human’s merge or another chat’s while a sibling is in progress', () => {
    expect(mergeWakesEpic({ siblings: 1, epicId: 'epic', mergedBy: null })).toBe(true)
    expect(mergeWakesEpic({ siblings: 2, epicId: 'epic', mergedBy: 'other' })).toBe(true)
  })

  it('holds with no sibling in progress', () => {
    expect(mergeWakesEpic({ siblings: 0, epicId: 'epic', mergedBy: null })).toBe(false)
  })

  it('holds when the epic merged it itself', () => {
    expect(mergeWakesEpic({ siblings: 3, epicId: 'epic', mergedBy: 'epic' })).toBe(false)
  })
})
