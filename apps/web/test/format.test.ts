import { describe, expect, it } from 'vitest'
import { humanizeTimestamps } from '../src/lib/format'

/**
 * Findings F10.9 / F18 — agent-authored docs stamp themselves the way a program
 * does ("Created: 2026-07-14T14:58:23.231Z"), and the doc peek rendered that
 * verbatim. The formatter is injected so this does not depend on the runner's
 * locale or timezone.
 */
const at = (ts: number) => `<${ts}>`

describe('humanizeTimestamps', () => {
  it('rewrites a full ISO instant', () => {
    const ms = Date.parse('2026-07-14T14:58:23.231Z')
    expect(humanizeTimestamps('Created: 2026-07-14T14:58:23.231Z', at)).toBe(`Created: <${ms}>`)
  })

  it('rewrites every instant in the document', () => {
    const out = humanizeTimestamps('a 2026-01-01T00:00:00Z b 2026-01-02T00:00:00Z', at)
    expect(out).toBe(`a <${Date.parse('2026-01-01T00:00:00Z')}> b <${Date.parse('2026-01-02T00:00:00Z')}>`)
  })

  it('handles offsets as well as Z', () => {
    const ms = Date.parse('2026-07-14T14:58:23+02:00')
    expect(humanizeTimestamps('at 2026-07-14T14:58:23+02:00', at)).toBe(`at <${ms}>`)
  })

  it('leaves a bare date alone — it is already readable', () => {
    expect(humanizeTimestamps('shipped 2026-07-14', at)).toBe('shipped 2026-07-14')
  })

  it('leaves prose with no timestamps untouched', () => {
    expect(humanizeTimestamps('# Brief\n\nNothing dated here.', at)).toBe(
      '# Brief\n\nNothing dated here.',
    )
  })

  it('uses a real locale string by default', () => {
    const out = humanizeTimestamps('Created: 2026-07-14T14:58:23.231Z')
    expect(out).not.toContain('T14:58:23.231Z')
    expect(out.startsWith('Created: ')).toBe(true)
  })
})
