// @vitest-environment happy-dom
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureStatus } from '@runcastle/core'
import type { FeatureFull, ProjectConversation, ProjectSession } from '../src/lib/api'
import { full as fixture } from './fixtures'

/**
 * Opening a feature (or showing an ended project conversation) resumes its chat
 * by itself (`opening-a-feature-shows-its-chat-as-you-left-it`): one launch with
 * `auto: true`, once per visit to a conversation, never for a feature that is
 * not in progress, has no conversation, or has something live.
 *
 * Tier 2: the assertions are the launches a render fires, and how often.
 */

const featureLaunch = vi.fn()
const projectLaunch = vi.fn()
let featureMutationOptions: { onError?: unknown } = {}

vi.mock('../src/trpc', () => {
  const query = (data: unknown) => () => ({ data, isPending: false })
  const invalidate = vi.fn(() => Promise.resolve())
  return {
    trpc: {
      useUtils: () => ({
        feature: { get: { invalidate }, list: { invalidate } },
        events: { invalidate },
        project: { projectSession: { invalidate }, conversations: { invalidate } },
      }),
      feature: {
        launchSession: {
          useMutation: (opts: { onError?: unknown }) => {
            featureMutationOptions = opts
            return { mutate: featureLaunch, isPending: false }
          },
        },
        list: { useQuery: query([]) },
        driveInfo: { useQuery: query(null) },
        driveScenarios: { useQuery: query({ runnerConfigured: false, scenarios: [] }) },
        endSession: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      project: {
        list: { useQuery: query([{ id: 'proj_1', name: 'acme' }]) },
        branches: { useQuery: query({ current: 'main', detected: 'main', branches: ['main'] }) },
        testDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        projectSession: { useQuery: query(null) },
        conversations: { useQuery: query([]) },
        conversationTranscript: {
          useQuery: query({ status: 'ok', runtime: 'claude-code', turns: [{ role: 'user', text: 'where were we?' }] }),
        },
        talkToProject: { useMutation: () => ({ mutate: projectLaunch, isPending: false }) },
      },
      projectNotes: {
        list: { useQuery: query([]) },
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

const { useFeatureAutoResume } = await import('../src/lib/use-auto-resume')
const { useProjectTalk } = await import('../src/lib/use-project-talk')
const { ProjectWorkspace } = await import('../src/components/ProjectWorkspace')

type Session = FeatureFull['sessions'][number]

function chat(over: Partial<Session> = {}): Session {
  return {
    id: 'sess_chat',
    featureId: 'feat_1',
    kind: 'chat',
    status: 'ended',
    ccSessionId: 'cc-1',
    awaitingInput: false,
    worktreePath: '/tmp/talk',
    createdAt: 0,
    ...over,
  } as Session
}

function feature(status: FeatureStatus, sessions: Session[]): FeatureFull {
  const f = fixture()
  return { ...f, feature: { ...f.feature, status }, sessions }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('opening a feature', () => {
  it('resumes an in-progress feature\'s ended chat once, quietly, with auto on the wire', () => {
    const full = feature('active', [chat()])
    const { rerender } = renderHook(({ f }) => useFeatureAutoResume('feat_1', f), { initialProps: { f: full } })
    rerender({ f: { ...full } })

    expect(featureLaunch).toHaveBeenCalledTimes(1)
    expect(featureLaunch).toHaveBeenCalledWith({ featureId: 'feat_1', kind: 'chat', auto: true })
    // its own error handler, so the app's toast-everything net stays out of it
    expect(typeof featureMutationOptions.onError).toBe('function')
  })

  it('tries again on the next visit, not on the same one', () => {
    const full = feature('active', [chat()])
    const { rerender } = renderHook(({ id }) => useFeatureAutoResume(id, full), { initialProps: { id: 'feat_1' } })
    // the resume did not take: the same conversation is still at rest
    rerender({ id: 'feat_1' })
    expect(featureLaunch).toHaveBeenCalledTimes(1)

    rerender({ id: 'feat_2' })
    rerender({ id: 'feat_1' })
    expect(featureLaunch).toHaveBeenCalledTimes(3)
  })

  it.each<[string, FeatureFull]>([
    ['a shipped feature', feature('shipped', [chat()])],
    ['an archived feature', feature('archived', [chat()])],
    ['a feature with no conversation yet', feature('active', [])],
    ['a chat that never went live', feature('active', [chat({ ccSessionId: undefined })])],
    ['a live chat', feature('active', [chat({ status: 'live' })])],
    ['a live terminal of another kind', feature('active', [chat(), chat({ id: 'sess_fix', kind: 'drive-fix', status: 'live' })])],
  ])('fires nothing for %s', (_, full) => {
    renderHook(() => useFeatureAutoResume('feat_1', full))
    expect(featureLaunch).not.toHaveBeenCalled()
  })

  /** An End the human clicked stays ended: a conversation up this visit never resumes by itself. */
  it('does not resume a chat that ended while the page was open', () => {
    const { rerender } = renderHook(({ f }) => useFeatureAutoResume('feat_1', f), {
      initialProps: { f: feature('active', [chat({ status: 'live' })]) },
    })
    rerender({ f: feature('active', [chat()]) })
    expect(featureLaunch).not.toHaveBeenCalled()
  })

  /**
   * Coming back to a feature whose untouched chat the leave timer closed: the
   * cache from the last visit still shows it live. That stale row must not count
   * as "up this visit", or the fresh one never resumes.
   */
  it('resumes on return although the cached data from the last visit still shows the chat live', () => {
    const before = Date.now() - 60_000
    const { rerender } = renderHook(({ f, at }) => useFeatureAutoResume('feat_1', f, at), {
      initialProps: { f: feature('active', [chat({ status: 'live' })]), at: before },
    })
    expect(featureLaunch).not.toHaveBeenCalled()

    rerender({ f: feature('active', [chat()]), at: Date.now() + 1 })
    expect(featureLaunch).toHaveBeenCalledTimes(1)
  })

  it('waits for data fetched this visit before resuming', () => {
    const { rerender } = renderHook(({ at }) => useFeatureAutoResume('feat_1', feature('active', [chat()]), at), {
      initialProps: { at: Date.now() - 60_000 },
    })
    expect(featureLaunch).not.toHaveBeenCalled()
    rerender({ at: Date.now() + 1 })
    expect(featureLaunch).toHaveBeenCalledTimes(1)
  })
})

describe('the project page', () => {
  const ended: ProjectConversation = {
    id: 'conv_1',
    title: 'the old chat',
    createdAt: null,
    status: 'ended',
    resumable: true,
  }
  const talk = (over: Partial<ReturnType<typeof useProjectTalk>> = {}) => ({
    session: null as ProjectSession,
    state: 'none' as const,
    conversations: [ended],
    conversationsPending: false,
    start: vi.fn(),
    triage: vi.fn(),
    replace: vi.fn(),
    resume: vi.fn(),
    autoResume: vi.fn(),
    autoResuming: null,
    starting: false,
    ...over,
  })

  let api: ReturnType<typeof talk>
  beforeEach(() => {
    api = talk()
  })

  it('resumes the ended conversation it shows, once, and says Resuming… while it does', () => {
    const { rerender } = render(<ProjectWorkspace projectId="proj_1" talk={api} />)
    expect(api.autoResume).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('the old chat'))
    expect(api.autoResume).toHaveBeenCalledTimes(1)
    expect(api.autoResume).toHaveBeenCalledWith('conv_1')

    rerender(<ProjectWorkspace projectId="proj_1" talk={{ ...api, autoResuming: 'conv_1' }} />)
    expect(screen.getByText('Resuming…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume the conversation' })).toBeNull()
    expect(screen.getByText('where were we?')).toBeTruthy()
    expect(api.autoResume).toHaveBeenCalledTimes(1)
  })

  it('sends a resume-only launch that never toasts', () => {
    const { result } = renderHook(() => useProjectTalk('proj_1'))
    result.current.autoResume('conv_1')
    expect(projectLaunch).toHaveBeenCalledWith({ projectId: 'proj_1', resumeSessionId: 'conv_1', auto: true })
  })
})
