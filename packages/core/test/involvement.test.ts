import { describe, expect, it } from 'vitest'
import { DECIDED_WITHOUT_YOU_MARK, decidedWithoutYou } from '../src/involvement'

describe('decidedWithoutYou', () => {
  it('lists only the numbered entries carrying the mark, in file order', () => {
    const md = [
      '# X: decisions',
      '',
      '## 1. Asked',
      '**Decision:** a',
      '**Why:** "yes"',
      '',
      '## 4. Expired cards stay',
      DECIDED_WITHOUT_YOU_MARK,
      '**Decision:** keep them',
      '',
      '## Unnumbered',
      DECIDED_WITHOUT_YOU_MARK,
      '',
      '## 7. A card is removed with one tap  ',
      '**Decision:** b',
      DECIDED_WITHOUT_YOU_MARK,
    ].join('\n')
    expect(decidedWithoutYou(md)).toEqual([
      { n: 4, title: 'Expired cards stay' },
      { n: 7, title: 'A card is removed with one tap' },
    ])
  })

  it('reads ### entries under a brief.md’s ## Decisions, not the sections around them', () => {
    const md = [
      '## Purpose',
      DECIDED_WITHOUT_YOU_MARK,
      '',
      '## Decisions',
      '',
      '### 1. Asked',
      '**Decision:** a',
      '',
      '### 2. Screens stay',
      '**Why:** b',
      DECIDED_WITHOUT_YOU_MARK,
      '',
      '## Build notes',
      'c',
    ].join('\n')
    expect(decidedWithoutYou(md)).toEqual([{ n: 2, title: 'Screens stay' }])
  })

  it('is empty for a file with no marks', () => {
    expect(decidedWithoutYou('## 1. A\n**Decision:** b')).toEqual([])
  })
})
