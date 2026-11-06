import { claudeCode } from '@ai-hero/sandcastle'
import { describe, expect, it } from 'vitest'

/**
 * A third clause of the `patches/@ai-hero%2Fsandcastle@0.12.0.patch` contract
 * (honest-token-counts decision 10): sandcastle's stream parser logs a tool call
 * only for tools in its argument map, which knew shell, web and sub-agent calls
 * alone — so a worker's reads, edits and searches never reached the burn log or
 * its timing. Driven through the compiled provider, because the patch's risk is
 * a `bun install` that silently stops applying it.
 */
const toolUse = (name: string, input: Record<string, unknown>): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })

describe('burn logs show file work (patched)', () => {
  it.each([
    ['Read', { file_path: '/repo/src/a.ts' }, '/repo/src/a.ts'],
    ['Write', { file_path: '/repo/b.ts', content: 'x' }, '/repo/b.ts'],
    ['Edit', { file_path: '/repo/c.ts', old_string: 'a', new_string: 'b' }, '/repo/c.ts'],
    ['MultiEdit', { file_path: '/repo/d.ts', edits: [] }, '/repo/d.ts'],
    ['NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: '' }, '/repo/n.ipynb'],
    ['Grep', { pattern: 'TODO', path: '/repo' }, 'TODO'],
    ['Glob', { pattern: '**/*.ts' }, '**/*.ts'],
  ])('logs %s with its path or pattern', (name, input, args) => {
    expect(claudeCode('claude-opus-5-5').parseStreamLine(toolUse(name, input))).toEqual([
      { type: 'tool_call', name, args },
    ])
  })

  it('still logs the shell calls it always did', () => {
    expect(claudeCode('claude-opus-5-5').parseStreamLine(toolUse('Bash', { command: 'ls' }))).toEqual([
      { type: 'tool_call', name: 'Bash', args: 'ls' },
    ])
  })
})
