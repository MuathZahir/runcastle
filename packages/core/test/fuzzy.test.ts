import { describe, expect, it } from 'vitest'
import { fuzzyScore, rankNames, rankPaths } from '../src/fuzzy'

describe('the composer fuzzy finder', () => {
  it('ranks a prefix over a word start over a substring over scattered letters', () => {
    const names = ['caveman-compress', 'recompute', 'compact', 'cmpt', 'clear']
    expect(rankNames(names, (n) => n, 'comp')).toEqual(['compact', 'caveman-compress', 'recompute'])
    expect(rankNames(names, (n) => n, 'cmp')).toEqual(['cmpt', 'compact', 'caveman-compress', 'recompute'])
  })

  it('rates consecutive and word-start letters above scattered ones', () => {
    expect(fuzzyScore('feature-chat', 'fc')!).toBeGreaterThan(fuzzyScore('fabric', 'fc')!)
    expect(fuzzyScore('anything', 'xyz')).toBeNull()
  })

  it("puts a file name's match before the same match elsewhere in a path, then shorter paths", () => {
    expect(rankPaths(['notes/readme-old/x.md', 'docs/readme.md', 'README.md'], 'readme')).toEqual(['README.md', 'docs/readme.md', 'notes/readme-old/x.md'])
    expect(rankPaths(['a.ts', 'b.ts', 'c/d.ts'], '', 2)).toEqual(['a.ts', 'b.ts'])
  })
})
