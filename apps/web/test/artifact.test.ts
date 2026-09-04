import { describe, expect, it } from 'vitest'
import { artifactSelection, countDecisions } from '../src/lib/feature-ui/artifact'

describe('artifactSelection', () => {
  const docs = [
    { relPath: 'docs/features/example/decisions.md' },
    { relPath: 'docs/features/example/spec.md' },
  ]

  it.each([
    ['ideation', true, { kind: 'map' }],
    ['ideation', false, { kind: 'decisions', relPath: docs[0]?.relPath }],
    ['spec', true, { kind: 'spec', relPath: docs[1]?.relPath }],
    ['spec', false, { kind: 'spec', relPath: docs[1]?.relPath }],
  ] as const)('selects %s when mapped is %s', (phase, mapped, expected) => {
    expect(artifactSelection({ phase, mapped, docs })).toEqual(expected)
  })

  it('keeps the artifact kind when its document is not written yet', () => {
    expect(artifactSelection({ phase: 'spec', mapped: false, docs: [] })).toEqual({ kind: 'spec' })
  })
})

describe('countDecisions', () => {
  it('counts only level-two headings at the beginning of a line', () => {
    expect(countDecisions('# Decisions\n\n## First\ntext ## not a heading\n### Detail\n## Second')).toBe(2)
  })
})
