import { describe, expect, it } from 'vitest'
import { total } from './index'

describe('total', () => {
  it('sums through the workspace dependency', () => {
    expect(total([1, 2, 3])).toBe(6)
  })
})
