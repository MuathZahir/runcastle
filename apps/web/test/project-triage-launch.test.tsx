// @vitest-environment happy-dom
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'
import type { ProjectSession } from '../src/lib/api'

/**
 * The Triage door (decisions.md #6): the Notes card's button opens a project
 * chat briefed to triage the open notes, and the same open-it / replace-it
 * choice New chat offers stands in its way when a chat is already live.
 *
 * Tier 2: the assertions are the arguments a click sends to `talkToProject` and
 * the notice that appears in front of it — neither is a string the resting
 * markup carries.
 */

const launch = vi.fn()
const endSession = vi.fn()
const notes = vi.fn<() => ProjectNote[]>(() => [])
let endOptions: { onSuccess?: () => void } = {}
let session: ProjectSession | null = null

vi.mock('../src/trpc', () => {
  const query = (data: unknown) => () => ({ data, isPending: false })
  const invalidate = vi.fn()
  return {
    trpc: {
      useUtils: () => ({
        project: { projectSession: { invalidate }, conversations: { invalidate } },
        projectNotes: { invalidate },
      }),
      project: {
        list: { useQuery: query([{ id: 'proj_1', name: 'acme' }]) },
        branches: { useQuery: query({ current: 'main', detected: 'main', branches: ['main'] }) },
        testDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        projectSession: { useQuery: () => ({ data: session, isPending: false }) },
        conversations: { useQuery: query([]) },
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
        endSession: {
          useMutation: (opts: { onSuccess?: () => void }) => {
            endOptions = opts
            return { mutate: endSession, isPending: false }
          },
        },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
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
  it('opens a triage chat with the purpose on the wire', () => {
    const { result } = renderHook(() => useProjectTalk('proj_1'))
    result.current.triage()
    expect(launch).toHaveBeenCalledWith({ projectId: 'proj_1', purpose: 'triage' })
  })

  /**
   * Replacing from the Triage door has to open the chat the human asked for —
   * the relaunch happens a render later, in `endSession`'s callback, with
   * nothing of the click left to read unless the purpose is carried.
   */
  it('carries the purpose through an end-and-replace', () => {
    session = live
    const { result } = renderHook(() => useProjectTalk('proj_1'))

    result.current.replace('triage')
    expect(endSession).toHaveBeenCalledWith({ sessionId: 'sess_1' })
    endOptions.onSuccess?.()
    expect(launch).toHaveBeenCalledWith({
      projectId: 'proj_1',
      fresh: true,
      purpose: 'triage',
    })

    // a plain New chat replacement is still plain
    launch.mockClear()
    result.current.replace()
    endOptions.onSuccess?.()
    expect(launch).toHaveBeenCalledWith({ projectId: 'proj_1', fresh: true })
  })
})

describe('the project workspace at rest', () => {
  const talk = (over: Partial<ReturnType<typeof useProjectTalk>> = {}) => ({
    session: null,
    state: 'none' as const,
    conversations: [],
    conversationsPending: false,
    start: vi.fn(),
    triage: vi.fn(),
    replace: vi.fn(),
    resume: vi.fn(),
    starting: false,
    ...over,
  })

  /** The inbox is the page's one aside, open while something waits in it. */
  it('opens the Notes aside beside the page while a note is open, and folds it on request', () => {
    render(<ProjectWorkspace projectId="proj_1" talk={talk()} />)

    const aside = screen.getByRole('complementary', { name: 'Notes' })
    expect(within(aside).getByRole('region', { name: 'Notes' })).toBeTruthy()
    // the page comes first, the aside beside it
    expect(
      screen.getByText('Talk it through').compareDocumentPosition(aside),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const toggle = screen.getByRole('button', { name: 'Notes (1)' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('complementary', { name: 'Notes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Notes (1)' }))
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeTruthy()
  })

  it('triages straight away when no chat is open', () => {
    const api = talk()
    render(<ProjectWorkspace projectId="proj_1" talk={api} />)

    fireEvent.click(screen.getByRole('button', { name: 'Triage 1' }))
    expect(api.triage).toHaveBeenCalledTimes(1)
  })

  /** One live chat per project, so the Triage click asks before it replaces. */
  it('offers the open / replace choice when a chat is already live', () => {
    const api = talk({ session: live })
    render(<ProjectWorkspace projectId="proj_1" talk={api} />)

    // the live conversation owns the body; the inbox is a step back from it
    fireEvent.click(screen.getByRole('button', { name: 'acme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Triage 1' }))
    expect(api.triage).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('A chat is already open.')

    fireEvent.click(screen.getByRole('button', { name: 'End it and start new' }))
    expect(api.replace).toHaveBeenCalledWith('triage')
  })

  /** Capture's View asks for the inbox; a live chat must not hide it. */
  it('steps out of a live chat to the Notes card when the inbox is asked for', () => {
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
      const card = screen.getByRole('region', { name: 'Notes' })
      expect(card.closest('[hidden]')).toBeNull()
      expect(scroll.mock.contexts).toContain(card)
      expect(consumed).toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})
