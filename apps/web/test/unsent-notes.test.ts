import { describe, expect, it } from 'vitest'
import type { TestNote } from '@runcastle/core'
import { unsentNotes } from '../src/components/review/SendToAgent'

const note = (over: Partial<TestNote>): TestNote =>
  ({ id: 'n', featureId: 'f', text: 'x', status: 'open', author: 'human', ...over }) as TestNote

describe('what Send to agent would carry', () => {
  it('is the human’s unsent notes, never a promoted one or the review agent’s', () => {
    const kept = note({ id: 'kept' })
    const notes = [kept, note({ id: 'sent', sentAt: 1 }), note({ id: 'agent', author: 'agent' }), note({ id: 'promoted', status: 'promoted' })]
    expect(unsentNotes(notes)).toEqual([kept])
  })
})
