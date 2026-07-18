import { describe, expect, it } from 'vitest'
import { canon } from '../src/services/git'

describe('canon (path canonicalization)', () => {
  it('keeps case-distinct paths distinct on a case-sensitive filesystem', () => {
    // POSIX only: `/repo` and `/Repo` are genuinely different directories, so
    // canon() must not fold them into one registry key.
    if (process.platform === 'win32') return
    const upper = canon('/nonexistent-canon-test/Repo')
    const lower = canon('/nonexistent-canon-test/repo')
    expect(upper).not.toBe(lower)
  })

  it('preserves a backslash, a legal filename character, on POSIX', () => {
    if (process.platform === 'win32') return
    // The backslash is part of the (nonexistent) directory name, not a separator.
    expect(canon('/nonexistent-canon-test/a\\b')).toContain('\\')
  })
})
