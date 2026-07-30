import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { activityLine, stripMarkdown } from '../src/lib/activity'

/**
 * Findings F10.5 / F18 — the activity feed leaked agent internals (`Bash cd
 * /home/agent/repo && git add…`) and rendered raw `##` markdown as plain text,
 * then truncated both with no way to see the rest.
 */

const ev = (over: Partial<EventRow>): Pick<EventRow, 'type' | 'message' | 'data'> => ({
  type: 'feature.created',
  message: 'created',
  data: null,
  ...over,
})

describe('stripMarkdown', () => {
  it('drops heading markers', () => {
    expect(stripMarkdown('## What I did')).toBe('What I did')
    expect(stripMarkdown('###### deep')).toBe('deep')
  })

  it('unwraps emphasis, code spans and links', () => {
    expect(stripMarkdown('**done** with `bun test`')).toBe('done with bun test')
    expect(stripMarkdown('see [the spec](docs/spec.md)')).toBe('see the spec')
    expect(stripMarkdown('~~cancelled~~')).toBe('cancelled')
    expect(stripMarkdown('a *little* thing')).toBe('a little thing')
  })

  it('drops list and quote markers but keeps the item', () => {
    expect(stripMarkdown('- first\n- second')).toBe('first\nsecond')
    expect(stripMarkdown('1. first')).toBe('first')
    expect(stripMarkdown('> quoted')).toBe('quoted')
  })

  it('leaves prose with no markdown in it alone', () => {
    expect(stripMarkdown('merged feature/x into main')).toBe('merged feature/x into main')
  })

  it('does not eat an underscore inside an identifier', () => {
    expect(stripMarkdown('run_id and ticket_id')).toBe('run_id and ticket_id')
  })
})

describe('activityLine', () => {
  it('summarizes a tool call by its tool, not its payload', () => {
    const line = activityLine(
      ev({
        type: 'burn.tool',
        message: 'Bash cd /home/agent/repo && git add -A && git commit -m "wip"',
        data: { name: 'Bash', args: 'cd /home/agent/repo && git add -A && git commit -m "wip"' },
      }),
    )
    expect(line.summary.startsWith('Bash')).toBe(true)
    expect(line.summary.length).toBeLessThanOrEqual(80)
    expect(line.detail).toContain('git commit')
  })

  it('names a tool that was called with nothing', () => {
    const line = activityLine(ev({ type: 'burn.tool', message: 'Read', data: { name: 'Read' } }))
    expect(line.summary).toBe('Read')
    expect(line.detail).toBeNull()
  })

  it('falls back to one line when a tool event carries no structured payload', () => {
    const line = activityLine(
      ev({ type: 'burn.tool', message: 'Bash something\nand more', data: null }),
    )
    expect(line.summary).toBe('Bash something')
    expect(line.detail).toBe('Bash something\nand more')
  })

  it('renders agent prose as plain text, not markdown source', () => {
    const line = activityLine(
      ev({ type: 'burn.text', message: '## Plan\n\nWrite the **test** first.' }),
    )
    expect(line.summary).toBe('Plan')
    expect(line.summary).not.toContain('#')
    expect(line.detail).toBe('Plan\n\nWrite the test first.')
  })

  it('offers no expansion for a message that already fits', () => {
    expect(activityLine(ev({ message: 'feature archived' }))).toEqual({
      summary: 'feature archived',
      detail: null,
    })
  })

  it('keeps the whole message available when the summary truncates it', () => {
    const long = 'x'.repeat(400)
    const line = activityLine(ev({ message: long }))
    expect(line.summary.endsWith('…')).toBe(true)
    expect(line.detail).toBe(long)
  })

  it('never renders an empty row', () => {
    expect(activityLine(ev({ type: 'phase.advanced', message: '' })).summary).toBe('phase.advanced')
  })
})
