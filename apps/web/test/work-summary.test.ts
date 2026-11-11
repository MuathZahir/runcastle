import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolCall, WorkStep } from '../src/lib/chat-thread'
import { WorkBlock, workSummary } from '../src/components/chat/thread/Work'

/**
 * A settled run of work's row says what ran (calmer-worker-chats decisions 1,
 * 7, 8): a pure count of its steps, in one fixed order, then its time. Tier 1:
 * the function, and the fold's closed line as static markup.
 */

let n = 0
const call = (kind: ToolCall['kind'], title: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id: `c${++n}`, kind, title, status })
const tools = (...calls: ToolCall[]): WorkStep => ({ kind: 'tools', id: `t${++n}`, calls })
const subagent = (title: string, ...calls: ToolCall[]): WorkStep => ({ kind: 'subagent', id: `s${++n}`, title, status: 'completed', calls })

/** The fold's closed line: its button's words, markup aside. */
const line = (html: string) => (html.match(/<button[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? '').replace(/<[^>]+>/g, '')

describe('workSummary', () => {
  it('counts in one fixed order whatever order the calls ran in: commands, reads, edits, searches, fetches, subagents, other tools', () => {
    const steps: WorkStep[] = [
      tools(call('other', 'mcp__runcastle__show_file'), call('fetch', 'Fetch https://example.com'), call('search', 'grep foo')),
      subagent('Explore the repo', call('read', 'Read x.ts'), call('execute', 'ls')),
      tools(call('edit', 'Edit a.ts'), call('read', 'Read b.ts'), call('execute', 'bun test')),
      tools(call('execute', 'bun run typecheck'), call('other', 'Load skill: tdd')),
    ]
    expect(workSummary(steps)).toBe(
      'Ran 2 commands, read 1 file, edited 1 file, searched for 1 pattern, fetched 1 page, ran 1 subagent, used 2 tools',
    )
  })

  it('counts edits, deletes and moves together as files edited, each file once', () => {
    const steps = [tools(call('edit', 'Edit a.ts'), call('edit', 'Edit a.ts'), call('delete', 'Delete b.ts'), call('move', 'Move c.ts'))]
    expect(workSummary(steps)).toBe('Edited 3 files')
  })

  it('counts a file read twice once, a range read included', () => {
    const steps = [tools(call('read', 'Read src/a.ts'), call('read', 'Read src/a.ts (1 - 40)'), call('read', 'Read src/b.ts'))]
    expect(workSummary(steps)).toBe('Read 2 files')
  })

  it('counts each subagent as one and leaves its own calls to its card', () => {
    const steps = [subagent('One', call('execute', 'ls'), call('read', 'Read a.ts')), subagent('Two', call('edit', 'Edit b.ts'))]
    expect(workSummary(steps)).toBe('Ran 2 subagents')
  })

  it('says each count in the plural only past one', () => {
    expect(workSummary([tools(call('execute', 'ls'))])).toBe('Ran 1 command')
    expect(workSummary([tools(call('other', 'mcp__runcastle__hand_back'), call('other', 'mcp__runcastle__show_file'))])).toBe('Used 2 tools')
  })

  it('is empty for a run of thinking only', () => {
    expect(workSummary([{ kind: 'thought', id: 'th', seconds: 3, text: 'Hmm.' }])).toBe('')
  })
})

describe('the work row', () => {
  it('reads the summary, then its time', () => {
    const html = renderToStaticMarkup(
      createElement(WorkBlock, { seconds: 32, steps: [tools(call('execute', 'ls'), call('execute', 'bun test'), call('read', 'Read a.ts'), call('read', 'Read b.ts'))] }),
    )
    expect(line(html)).toMatch(/^Ran 2 commands, read 2 files\s*· 32s$/)
  })

  it('keeps "Thought for" for a run of thinking only', () => {
    const html = renderToStaticMarkup(createElement(WorkBlock, { seconds: 8, steps: [{ kind: 'thought', id: 'th', seconds: 8, text: 'Hmm.' }] }))
    expect(html).toContain('Thought for 8s')
    expect(html).not.toContain('Ran ')
  })

  it('shows a live run step by step, with no summary', () => {
    const html = renderToStaticMarkup(
      createElement(WorkBlock, { seconds: 0, live: true, steps: [tools(call('read', 'Read a.ts'), call('execute', 'bun test', 'in_progress'))] }),
    )
    expect(html).toContain('bun test')
    expect(html).not.toMatch(/Ran \d+ command/)
    expect(html).not.toContain('aria-expanded')
  })
})
