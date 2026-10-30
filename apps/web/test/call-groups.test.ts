import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../src/lib/chat-thread'
import { groupCalls, groupText } from '../src/components/chat/thread/Work'

/** Calls of one family in a row read as one line (the-chat-looks-the-part decision 12). */
const call = (id: string, kind: ToolCall['kind'], title: string, status: ToolCall['status'] = 'completed'): ToolCall => ({
  id,
  kind,
  title,
  status,
})

const shape = (calls: ToolCall[]) => groupCalls(calls).map((r) => (r.kind === 'one' ? r.call.id : r.calls.map((c) => c.id)))

describe('groupCalls', () => {
  it('leaves a lone call alone', () => {
    expect(shape([call('a', 'read', 'src/a.ts')])).toEqual(['a'])
  })

  it('folds two or more of one family in a row', () => {
    expect(shape([call('a', 'read', 'src/a.ts'), call('b', 'search', 'needle'), call('c', 'read', 'src/b.ts')])).toEqual([['a', 'b', 'c']])
  })

  it('keeps families apart, and a run broken by another family is two', () => {
    expect(
      shape([
        call('a', 'edit', 'src/a.ts'),
        call('b', 'edit', 'src/b.ts'),
        call('c', 'execute', 'bun test'),
        call('d', 'edit', 'src/c.ts'),
      ]),
    ).toEqual([['a', 'b'], 'c', 'd'])
  })

  it('never folds a call that reads as its own sentence', () => {
    expect(
      shape([
        call('a', 'other', 'mcp__runcastle__get_ticket'),
        call('b', 'fetch', 'mcp__runcastle__list_tickets'),
        call('c', 'fetch', 'mcp__runcastle__get_ticket'),
      ]),
    ).toEqual(['a', 'b', 'c'])
  })

  it('leaves out a review that approved its action, and folds across it', () => {
    expect(
      shape([call('a', 'read', 'src/a.ts'), call('r', 'other', 'Guardian Review'), call('b', 'read', 'src/b.ts')]),
    ).toEqual([['a', 'b']])
  })
})

describe('groupText', () => {
  it('counts and names each kind, the first capitalised', () => {
    expect(groupText([call('a', 'read', 'src/a.ts'), call('b', 'read', 'src/b.ts'), call('c', 'search', 'needle')])).toBe(
      'Read 2 files, searched for 1 pattern',
    )
  })

  it('counts a file edited twice once', () => {
    const edit = (id: string, path: string): ToolCall => ({ ...call(id, 'edit', path), diff: { path, lines: [] } })
    expect(groupText([edit('a', 'src/a.ts'), edit('b', 'src/a.ts'), edit('c', 'src/b.ts')])).toBe('Edited 2 files')
  })

  it('counts a file read in two ranges once', () => {
    expect(groupText([call('a', 'read', 'Read src/a.ts (1 - 5)'), call('b', 'read', 'Read src/a.ts (6 - 10)')])).toBe('Read 1 file')
  })

  it('counts commands by call, however alike', () => {
    expect(groupText([call('a', 'execute', 'bun test'), call('b', 'execute', 'bun test')])).toBe('Ran 2 commands')
  })

  it('turns a kind with a call in flight to the present', () => {
    expect(groupText([call('a', 'execute', 'bun test'), call('b', 'execute', 'bun x', 'in_progress')])).toBe('Running 2 commands')
    expect(groupText([call('a', 'read', 'src/a.ts'), call('b', 'search', 'x', 'in_progress')])).toBe('Read 1 file, searching for 1 pattern')
  })
})
