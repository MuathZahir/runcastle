// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'
import type { ProjectSession } from '../src/lib/api'

/**
 * The Triage door (decisions.md #6): the Notes card's button opens a project
 * chat briefed to triage the open notes — its own new thread, beside any chat
 * already running (chat-as-web-components decision 14).
 *
 * Tier 2: the assertions are the arguments a click sends to `talkToProject` and
 * the thread it brings to the front — neither is a string the resting markup
 * carries.
 */

const launch = vi.fn()
const notes = vi.fn<() => ProjectNote[]>(() => [])
let session: ProjectSession | null = null

vi.mock('../src/trpc', () => {
  const query = (data: unknown) => () => ({ data, isPending: false })
  const invalidate = vi.fn()
  return {
    trpc: {
      useUtils: () => ({
        project: { projectSession: { invalidate } },
        projectNotes: { invalidate },
        thread: { list: { invalidate } },
      }),
      thread: {
        list: { useQuery: query([]) },
        new: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        rename: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      project: {
        list: { useQuery: query([{ id: 'proj_1', name: 'acme' }]) },
        branches: { useQuery: query({ current: 'main', detected: 'main', branches: ['main'] }) },
        testDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        projectSession: { useQuery: () => ({ data: session, isPending: false }) },
        talkToProject: { useMutation: () => ({ mutate: launch, isPending: false }) },
      },
      projectNotes: {
        list: { useQuery: () => ({ data: notes(), isPending: false }) },
        edit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        dismiss: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        reopen: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      feature: {
        list: { useQuery: query([]) },
        driveInfo: { useQuery: query(null) },
        driveScenarios: { useQuery: query({ runnerConfigured: false, scenarios: [] }) },
        // The map's drive doors, which this page answers but no test here asks.
        endSession: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
// The thread itself is ThreadColumn's own test; here it only has to be there.
vi.mock('../src/components/chat/ThreadColumn', () => ({
  ThreadColumn: ({ label, threadId }: { label?: string; threadId: string | null }) => (
    <section aria-label={label} data-thread-column="" data-thread={threadId ?? 'new'} />
  ),
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/use-session-branch', () => ({
  useSessionBranch: () => ({
    value: 'main',
    branches: ['main'],
    detected: 'main',
    missing: false,
    pick: () => {},
    picking: false,
  }),
}))

const { useProjectTalk } = await import('../src/lib/use-project-talk')
const { ProjectWorkspace } = await import('../src/components/ProjectWorkspace')

const NOTE: ProjectNote = {
  id: 'pnote_1',
  projectId: 'proj_1',
  text: 'the crumbs overflow on a long title',
  status: 'open',
  createdAt: 1_000,
  updatedAt: 1_000,
}

const live: ProjectSession = {
  id: 'sess_1',
  projectId: 'proj_1',
  kind: 'project',
  status: 'live',
  worktreePath: '/w',
} as ProjectSession

beforeEach(() => {
  session = null
  notes.mockReturnValue([NOTE])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useProjectTalk', () => {
  // decision 14: beside any chat already running, so a live one changes nothing.
  it('opens a triage chat with the purpose on the wire, and hands on its thread', () => {
    session = live
    const { result } = renderHook(() => useProjectTalk('proj_1'))
    const opened = vi.fn()
    result.current.triage(opened)
    expect(launch).toHaveBeenCalledWith({ projectId: 'proj_1', purpose: 'triage' }, expect.anything())
    launch.mock.calls[0][1].onSuccess({ sessionId: 'sess_triage' })
    expect(opened).toHaveBeenCalledWith('sess_triage')
  })
})

describe('the project workspace at rest', () => {
  const talk = (over: Partial<ReturnType<typeof useProjectTalk>> = {}): ReturnType<typeof useProjectTalk> => ({
    session: null,
    state: 'none',
    triage: vi.fn(),
    triaging: false,
    ...over,
  })

  /** The inbox is the panel's Notes view (design-mode decision 11), open while something waits in it. */
  it('opens the Notes panel beside the chat list while a note is open, and folds it on request', () => {
    render(<ProjectWorkspace projectId="proj_1" talk={talk()} />)

    const panel = (): HTMLElement | null => document.querySelector('[data-panel]')
    expect(within(panel()!).getAllByRole('region', { name: 'Notes' }).length).toBeGreaterThan(0)
    // the chat list comes first, the panel beside it
    expect(screen.getByText('Talk it through').compareDocumentPosition(panel()!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )

    const toggle = screen.getByRole('button', { name: 'Hide the panel (1)' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(panel()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show the panel (1)' }))
    expect(panel()).toBeTruthy()
  })

  it('triages straight away when no chat is open', () => {
    const api = talk()
    render(<ProjectWorkspace projectId="proj_1" talk={api} />)

    fireEvent.click(screen.getByRole('button', { name: 'Triage 1' }))
    expect(api.triage).toHaveBeenCalledTimes(1)
  })

  /** decision 14: no "end it and start new" — the triage chat runs beside the live one. */
  it('opens its own new thread when a chat is already live, with no notice', () => {
    const api = talk({ session: live })
    render(<ProjectWorkspace projectId="proj_1" talk={api} />)

    // the live conversation owns the body; the inbox is a step back from it
    fireEvent.click(screen.getByRole('button', { name: 'acme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Triage 1' }))
    expect(api.triage).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/already open|End it and start new/)).toBeNull()

    act(() => vi.mocked(api.triage).mock.calls[0][0]('sess_triage'))
    expect(document.querySelector<HTMLElement>('[data-thread-column]')?.dataset.thread).toBe('sess_triage')
  })

  /** Capture's View asks for the inbox; a live chat must not hide it. */
  it('opens the Notes card beside a live chat when the inbox is asked for', () => {
    const scroll = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      const consumed = vi.fn()
      render(
        <ProjectWorkspace
          projectId="proj_1"
          talk={talk({ session: live })}
          inboxRequest={1}
          onConsumeInboxRequest={consumed}
        />,
      )
      // the panel is named for its view, the card inside it for itself
      const card = screen.getAllByRole('region', { name: 'Notes' }).at(-1)!
      expect(card.closest('[hidden]')).toBeNull()
      expect(document.querySelector('[data-thread-column]')?.closest('[hidden], .hidden')).toBeNull()
      expect(scroll.mock.contexts).toContain(card)
      expect(consumed).toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})
