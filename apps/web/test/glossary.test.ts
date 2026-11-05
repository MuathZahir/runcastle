import { describe, expect, it } from 'vitest'
import { GLOSSARY, GLOSSARY_GROUP_ORDER, filterGlossary, glossaryEntry } from '../src/lib/glossary'

/**
 * The one list every hint and the Glossary dialog read (ready-to-publish
 * decision 16). Its filter is how someone who learned an old word finds the
 * new one (decision 20).
 */
describe('the glossary list', () => {
  it('holds sixteen words, one entry per id, in the four groups', () => {
    expect(GLOSSARY).toHaveLength(16)
    expect(new Set(GLOSSARY.map((e) => e.id)).size).toBe(16)
    expect(new Set(GLOSSARY.map((e) => e.group))).toEqual(new Set(GLOSSARY_GROUP_ORDER))
  })

  it('finds an entry by its id', () => {
    expect(glossaryEntry('held-by').term).toBe('Held by')
  })
})

describe('filterGlossary', () => {
  it('returns every word for an empty query', () => {
    expect(filterGlossary('')).toHaveLength(16)
    expect(filterGlossary('   ')).toHaveLength(16)
  })

  it('finds Round by the word it replaced', () => {
    // Worker comes too: it was once called burner.
    expect(filterGlossary('burn').map((e) => e.term)).toEqual(['Round', 'Worker'])
    expect(filterGlossary('BURN').map((e) => e.term)).toContain('Round')
  })

  it('needs every typed word to match', () => {
    expect(filterGlossary('drive mode').map((e) => e.term)).toEqual(['Test drive'])
    expect(filterGlossary('burn nonsense')).toEqual([])
  })
})
