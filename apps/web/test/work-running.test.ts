import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkStep } from '../src/lib/chat-thread'
import { WorkBlock } from '../src/components/chat/thread/Work'

/**
 * A folded run of work with a subagent from it still running
 * (the-status-tells-the-truth decision 4). Tier-1 static markup
 * (apps/web/STYLE.md): the fold's closed line is all there is to read.
 */
const STEPS: WorkStep[] = [
  { kind: 'tools', id: 't1', calls: [{ id: 'c1', kind: 'read', title: 'Read spec.md', status: 'completed' }] },
  { kind: 'subagent', id: 'a1', title: 'Build switcher direction mocks', status: 'in_progress', calls: [] },
]

const fold = (running?: { title: string; count: number }) =>
  renderToStaticMarkup(createElement(WorkBlock, { steps: STEPS, seconds: 50, ...(running ? { running } : {}) }))

/** The fold's line: its button's words, markup aside. */
const line = (html: string) => (html.match(/<button[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? '').replace(/<[^>]+>/g, '')

describe('a fold with a subagent still running', () => {
  it('stays closed, with a spinner and "Subagent running · <title>" in place of its time', () => {
    const html = fold({ title: 'Build switcher direction mocks', count: 1 })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-progress')
    expect(line(html)).toBe('Subagent running · Build switcher direction mocks')
    expect(html).not.toContain('Worked for')
  })

  it('names the first of several, and counts the rest', () => {
    expect(line(fold({ title: 'Build switcher direction mocks', count: 2 }))).toBe('2 subagents running · Build switcher direction mocks +1')
  })

  it('says only that one runs when it has no title (an older log)', () => {
    expect(line(fold({ title: '', count: 3 }))).toBe('3 subagents running')
  })

  it('reads what ran and its time, with no spinner, once nothing in it runs', () => {
    const html = fold()
    expect(line(html)).toMatch(/^Read 1 file, ran 1 subagent\s*· 50s$/)
    expect(html).not.toContain('data-progress')
  })
})
