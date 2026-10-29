// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEntry, ThreadItem, ToolCall } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { PlanStrip } from '../src/components/chat/thread/ComposerParts'
import { ChangesCard, WorkBlock } from '../src/components/chat/thread/Work'
import { SidebarThreadList } from '../src/components/SidebarParts'
import { sidebarThreadOrder } from '../src/lib/sidebar-threads'

/**
 * What the human reads in a thread (chat-as-web-components ticket 17): no
 * internals leak — tool rows say one verb and readable tool names, the
 * runcastle line carries no tag, the changes card keeps file names in view,
 * the background strip's time ticks, and a thread with images opens at its foot.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
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

  it("reads codex-acp's rows the same way: one verb, its MCP tools by server and words, its review in plain words", () => {
    expect(
      rows([
        call('mcp.runcastle.get_feature_context', 'execute'),
        call('Edit src/a.ts, src/b.ts', 'edit'),
        call('Editing files', 'edit'),
        call("List files in 'src'", 'read'),
        call('Web search: acp rate limits', 'search'),
        call('Compact conversation', 'think'),
        call('Start subagent Planner', 'other'),
      ]),
    ).toEqual([
      'runcastle: get feature context',
      'Editedsrc/a.ts, src/b.ts',
      'Editedfiles',
      "Listedfiles in 'src'",
      'Searched the webacp rate limits',
      'Compactedconversation',
      'Start subagent Planner',
    ])
  })

  it('shows a Codex command without the shell that launched it', () => {
    expect(
      rows([
        call(`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'Get-ChildItem src'`, 'execute'),
        call('powershell.exe -NoProfile -Command "git status"', 'execute'),
        call('cmd /c dir /b', 'execute'),
        call("/bin/bash -lc 'bun test'", 'execute'),
        call('bun run -c config', 'execute'),
      ]),
    ).toEqual(['RanGet-ChildItem src', 'Rangit status', 'Randir /b', 'Ranbun test', 'Ranbun run -c config'])
  })

  it("folds away a review that approved its action, and words one under way or one that stopped it for a person", () => {
    const review = (id: string, status: ToolCall['status']): ToolCall => ({ id, kind: 'think', title: 'Guardian Review', status, output: 'Status: Approved' })
    expect(rows([call('bun test', 'execute'), review('r1', 'completed'), review('r2', 'in_progress'), review('r3', 'failed')])).toEqual([
      'Ranbun test',
      "Checking with Codex's reviewer",
      "Stopped by Codex's reviewer",
    ])
    cleanup()
    render(<WorkBlock live seconds={3} steps={[{ kind: 'tools', id: 's', calls: [review('r1', 'completed')] }]} />)
    expect(screen.queryAllByRole('list')).toEqual([])
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
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it("folds a long briefing to its first sentence, its paths behind Show more", () => {
    const brief =
      '[runcastle] Proceed as a side session: you are a side session of this feature. You may do anything the main chat does.\n' +
      'The main chat said: "let us ship it".\nIts transcript: C:\\Users\\user\\.runcastle\\sessions\\ses_1\\transcript.jsonl'
    render(<ChatThread items={[{ kind: 'user', id: 'p', text: brief, from: 'runcastle' }]} state="idle" footer={null} />)
    const line = () => screen.getByText(/Proceed as a side session/).closest('p')?.textContent
    expect(line()).toBe('Runcastle · Proceed as a side session: you are a side session of this feature. Show more')
    expect(line()).not.toContain('transcript.jsonl')

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(line()).toContain('C:\\Users\\user\\.runcastle\\sessions\\ses_1\\transcript.jsonl')
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(line()).not.toContain('transcript.jsonl')
  })

  it('cuts a first sentence longer than a line at a word', () => {
    const long = `[runcastle] ${'word '.repeat(60)}end.`
    render(<ChatThread items={[{ kind: 'user', id: 'p', text: long, from: 'runcastle' }]} state="idle" footer={null} />)
    const text = screen.getByText(/word/).closest('p')?.textContent ?? ''
    expect(text).toMatch(/^Runcastle · (word )+word… Show more$/)
  })
})

describe("the agent's text", () => {
  it('keeps its single line breaks, and leaves lists and code blocks as they were', () => {
    const text = 'one\ntwo\nthree\n\n- a\n- b\n\n```\nx\ny\n```'
    const { container } = render(<ChatThread items={[{ kind: 'agent', id: 'a', text }]} state="idle" footer={null} />)
    const para = screen.getByText(/one/).closest('p')
    expect(para?.querySelectorAll('br')).toHaveLength(2)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('pre')?.textContent).toBe('x\ny\n')
    expect(container.querySelector('pre br')).toBeNull()
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

describe('the sidebar thread list', () => {
  const at = Date.now()
  const entry = (id: string, state: ThreadEntry['state'], over: Partial<ThreadEntry> = {}): ThreadEntry => ({
    id,
    title: `Thread ${id}`,
    role: 'project',
    state,
    createdAt: at,
    updatedAt: at,
    runtime: 'claude-code',
    ...over,
  })
  const row = (title: string) => screen.getByTitle(title).parentElement as HTMLElement

  it('marks each thread working, waiting or idle, as the project page list does', () => {
    render(<SidebarThreadList threads={[entry('a', 'working'), entry('b', 'waiting'), entry('c', 'idle')]} current="c" onOpen={() => {}} actionsFor={() => []} />)
    expect(row('Thread a').querySelector('[data-progress]')).not.toBeNull()
    expect(row('Thread b').innerHTML).toContain('bg-warning')
    expect(row('Thread c').textContent).toContain('now')
    expect(row('Thread c').querySelector('[data-progress]')).toBeNull()
  })

  it('ages no thread that has no time, and names none by its kind', () => {
    const threads: ThreadEntry[] = [
      entry('old', 'idle', { title: 'New chat', role: 'main', updatedAt: 0 }),
      entry('side', 'idle', { title: 'Fix the header', role: 'side', updatedAt: at - 3 * 3_600_000 }),
    ]
    render(<SidebarThreadList threads={threads} current="side" onOpen={() => {}} actionsFor={() => []} />)
    expect(row('New chat').textContent).toBe('New chat')
    expect(row('Fix the header').textContent).toBe('Fix the header3h')
  })

  it('shows five, then the rest in place; the one in front and any working or waiting show past five', () => {
    const threads = Array.from({ length: 9 }, (_, i) =>
      entry(`${i}`, i === 7 ? 'waiting' : 'idle', { title: `Thread ${i}` }),
    )
    const opened: string[] = []
    render(<SidebarThreadList threads={threads} current="8" onOpen={(id) => opened.push(id)} actionsFor={() => []} />)
    const titles = () => screen.getAllByRole('button').flatMap((b) => (b.title ? [b.title] : []))
    expect(titles()).toEqual(['Thread 0', 'Thread 1', 'Thread 2', 'Thread 3', 'Thread 4', 'Thread 7', 'Thread 8'])
    fireEvent.click(screen.getByRole('button', { name: /Show 2 more/ }))
    expect(titles()).toHaveLength(9)
    fireEvent.click(screen.getByTitle('Thread 5'))
    expect(opened).toEqual(['5'])
  })

  it('sends the Orchestrator’s rest to its page: "All N conversations"', () => {
    const threads = Array.from({ length: 80 }, (_, i) => entry(`${i}`, 'idle'))
    const more = vi.fn()
    render(<SidebarThreadList threads={threads} current={null} onOpen={() => {}} actionsFor={() => []} more={more} />)
    fireEvent.click(screen.getByRole('button', { name: /All 80 conversations/ }))
    expect(more).toHaveBeenCalledOnce()
  })

  it('keeps each thread’s place: the main chat first, then the newest started, whatever moved last', () => {
    const order = sidebarThreadOrder([
      entry('old-side', 'idle', { role: 'side', createdAt: 1, updatedAt: 99 }),
      entry('new-side', 'idle', { role: 'side', createdAt: 3, updatedAt: 3 }),
      entry('main', 'idle', { role: 'main', createdAt: 0, updatedAt: 0 }),
    ])
    expect(order.map((t) => t.id)).toEqual(['main', 'new-side', 'old-side'])
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

  /**
   * The round-10 review: after a reload a thread with images opened short of
   * its foot. Images grow the thread after its first scroll — and a scroll
   * event the growth brings, read as "off the foot", used to unstick it before
   * the image's `load` could follow. A loaded-from-cache image may never be
   * seen loading at all. The content's resize is what follows it down now.
   */
  function grownThread() {
    const observers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly cb: () => void) {}
        observe() {
          observers.push(this.cb)
        }
        disconnect() {}
      },
    )
    const items: ThreadItem[] = [
      { kind: 'user', id: 'p', text: 'look', images: [{ id: 'i', src: '/img.png', name: 'crop.png' }] },
      { kind: 'agent', id: 'a', text: 'The newest answer' },
    ]
    const { container } = render(<ChatThread items={items} state="idle" footer={null} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
    const grow = (to: number) => {
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: to })
      // What the browser does as the image lays out: a scroll event at the old position, then the resize.
      fireEvent.scroll(scroller)
      act(() => observers.forEach((cb) => cb()))
    }
    return { scroller, grow }
  }

  it('opens at its newest message once its images have grown it, with no load event seen', () => {
    const { scroller, grow } = grownThread()
    grow(600)
    expect(scroller.scrollTop).toBe(600)
    grow(1200)
    expect(scroller.scrollTop).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Jump to the newest' })).toBeNull()
  })

  it('leaves a reader who scrolled up where they are as the thread grows', () => {
    const { scroller, grow } = grownThread()
    grow(1200)
    scroller.scrollTop = 300
    fireEvent.scroll(scroller)
    grow(1600)
    expect(scroller.scrollTop).toBe(300)
    expect(screen.getByRole('button', { name: 'Jump to the newest' })).toBeTruthy()
  })
})

describe('editing a message', () => {
  it('says the undo covers the agent’s file edits only: shell commands’ changes stay', () => {
    render(<ChatThread items={[{ kind: 'user', id: 'p', text: 'Make it blue' }]} state="idle" actions={{ onEdit: vi.fn(), canUndoFiles: true }} footer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit and rewind to here' }))
    const undo = screen.getByRole('checkbox', { name: 'Also undo the agent’s file edits since — changes made by shell commands stay' }) as HTMLInputElement
    expect(undo.checked).toBe(true)
  })
})
