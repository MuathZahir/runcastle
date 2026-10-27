// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEntry, ThreadItem, ToolCall } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { PlanStrip } from '../src/components/chat/thread/ComposerParts'
import { ChangesCard, WorkBlock } from '../src/components/chat/thread/Work'
import { ThreadSwitcher } from '../src/components/chat/thread/ThreadSwitcher'
import { openMenu } from './floating'

/**
 * What the human reads in a thread (chat-as-web-components ticket 17): no
 * internals leak — tool rows say one verb and readable tool names, the
 * runcastle line carries no tag, the changes card keeps file names in view,
 * the background strip's time ticks, and a thread with images opens at its foot.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const call = (title: string, kind: ToolCall['kind'], status: ToolCall['status'] = 'completed'): ToolCall => ({ id: title, kind, title, status })

function rows(calls: ToolCall[]): string[] {
  render(<WorkBlock live seconds={0} steps={[{ kind: 'tools', id: 's', calls }]} />)
  return screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
}

describe('a tool row', () => {
  it('says one verb, even when the title opens with its own', () => {
    expect(
      rows([call('Read README.md (1 - 5)', 'read'), call('Edit src/a.ts', 'edit'), call('Edit', 'edit'), call('Write notes.md', 'edit'), call('bun test', 'execute')]),
    ).toEqual(['ReadREADME.md (1 - 5)', 'Editedsrc/a.ts', 'Edited', 'Wrotenotes.md', 'Ranbun test'])
  })

  it('names an MCP tool by its server and its words, and an internal tool in plain words', () => {
    expect(rows([call('mcp__runcastle__get_feature_context', 'other'), call('ToolSearch', 'other'), call('Load skill: tdd', 'other')])).toEqual([
      'runcastle: get feature context',
      'Usedtool search',
      'Load skill: tdd',
    ])
  })

  it('says the in-flight verb while it runs', () => {
    expect(rows([call('Read src/a.ts', 'read', 'in_progress')])).toEqual(['Readingsrc/a.ts'])
  })
})

describe('the runcastle line', () => {
  it('shows runcastle words without the tag the agent reads them by', () => {
    const items: ThreadItem[] = [{ kind: 'user', id: 'p', text: '[runcastle] Proceed with your task.', from: 'runcastle' }]
    render(<ChatThread items={items} state="idle" footer={null} />)
    expect(screen.getByText(/Proceed with your task/).closest('p')?.textContent).toBe('Runcastle · Proceed with your task.')
  })
})

describe('the changes card', () => {
  it('keeps the file name whole, the folders before it giving way', () => {
    render(<ChangesCard files={[{ path: 'apps/web/src/components/chat/thread/Work.tsx', added: 2, removed: 1, lines: [] }]} />)
    fireEvent.click(screen.getByRole('button', { name: /1 changed file/ }))
    const name = screen.getByText('Work.tsx')
    expect(name.className).toContain('shrink-0')
    expect(screen.getByText('apps/web/src/components/chat/thread/').closest('span.truncate')).not.toBeNull()
  })
})

describe('the background strip', () => {
  it("ticks a command's running time", () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    render(<PlanStrip plan={[]} tasks={[{ id: 't', title: 'bun dev', startedAt }]} />)
    expect(screen.getByText('running 0s')).toBeTruthy()
    act(() => vi.advanceTimersByTime(45_000))
    expect(screen.getByText('running 45s')).toBeTruthy()
  })
})

describe('the header thread list', () => {
  it('marks each thread working, waiting or idle as the project page list does', () => {
    const at = Date.now()
    const entry = (id: string, state: ThreadEntry['state']): ThreadEntry => ({ id, title: `Thread ${id}`, role: 'project', state, updatedAt: at, runtime: 'claude-code' })
    render(<ThreadSwitcher threads={[entry('a', 'working'), entry('b', 'waiting'), entry('c', 'idle')]} current="c" onPick={() => {}} onNew={() => {}} now={at} />)
    openMenu(screen.getByRole('button', { name: 'Thread' }))
    const row = (id: string) => screen.getByRole('menuitemradio', { name: new RegExp(`Thread ${id}`) })
    expect(row('a').textContent).toContain('working')
    expect(row('a').querySelector('[data-progress]')).not.toBeNull()
    expect(row('b').textContent).toContain('waiting for you')
    expect(row('b').innerHTML).toContain('bg-warning')
    expect(row('c').textContent).toContain('now')
    expect(row('c').querySelector('[data-progress]')).toBeNull()
  })
})

describe('a thread with images', () => {
  it('stays at its foot when an image loads', () => {
    const items: ThreadItem[] = [{ kind: 'user', id: 'p', text: 'look', images: [{ id: 'i', src: '/img.png', name: 'crop.png' }] }]
    const { container } = render(<ChatThread items={items} state="idle" footer={null} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1200 })
    fireEvent.load(container.querySelector('img')!)
    expect(scroller.scrollTop).toBe(1200)
  })
})
