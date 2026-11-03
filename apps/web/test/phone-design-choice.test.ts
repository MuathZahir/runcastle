import { describe, expect, it } from 'vitest'
import type { DesignEntry } from '@runcastle/core'
import { phoneViewChoices } from '../src/components/phone/phone-views'

/**
 * The phone's "…" sheet offers Design only once the feature has a recorded
 * design, since the phone has no design list (designs-and-the-plan-get-their-own-place
 * decision 16), and says what it holds.
 */

const design = (id: string, state: DesignEntry['state']): DesignEntry => ({ id, title: id, path: `/${id}`, state, isNew: false, shownAt: 1 })

describe('the phone sheet\'s Design line', () => {
  it('is left out while the feature has no design', () => {
    expect(phoneViewChoices(['plan', 'design'], [], []).map((c) => c.view)).toEqual(['plan'])
  })

  it('says how many designs wait, else how many there are', () => {
    const waiting = phoneViewChoices(['design'], [], [design('a', 'waiting'), design('b', 'approved')])
    expect(waiting).toEqual([{ view: 'design', label: 'Design', hint: '1 waiting for you' }])
    expect(phoneViewChoices(['design'], [], [design('a', 'approved'), design('b', 'approved')])[0]?.hint).toBe('2 designs')
  })
})
