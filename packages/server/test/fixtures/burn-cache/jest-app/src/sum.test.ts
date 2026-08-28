import { sum } from './sum'

describe('sum', () => {
  it('adds every value', () => {
    expect(sum([1, 2, 3])).toBe(6)
  })
})
