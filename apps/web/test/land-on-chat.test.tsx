// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandOnChatProvider, landingView, useLandOnChat } from '../src/lib/land-on-chat'
import { locationFor, pathFor } from '../src/lib/routes'
import { useResolveConflict } from '../src/lib/use-resolve-conflict'
import { useWorkspace } from '../src/lib/workspace'

/**
 * one-chat-layout-everywhere decision 3: every button that starts or resumes a
 * feature session lands on that feature's Chat tab, through ONE operation.
 *
 * Three observations: the operation selects the Chat tab and remembers it; the
 * resolve hook (the bar, the conflict card and the merge dialog all go through
 * it) lands once its launch succeeds and not when it never launched; and every
 * module that can launch a feature session calls the operation at all — so a
 * new launch site that forgets to land fails here rather than in the operator's
 * hands.
 */

const state = vi.hoisted(() => ({
  endFails: false,
  launches: [] as unknown[],
}))

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      feature: { get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      events: { invalidate: vi.fn() },
    }),
    feature: {
      endSession: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async () => {
            if (state.endFails) throw new Error('refused')
          },
        }),
      },
      launchSession: {
        useMutation: (opts: { onSuccess: (res: { sessionId: string }) => void }) => ({
          isPending: false,
          mutate: (vars: unknown) => {
            state.launches.push(vars)
            opts.onSuccess({ sessionId: 'ses_1' })
          },
        }),
      },
    },
  },
}))

const conflict = { base: 'main', files: ['a.ts'], at: 1 } as Parameters<
  ReturnType<typeof useResolveConflict>['resolve']
>[0]

describe('the land-on-chat operation', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it("selects the feature's Chat tab and remembers it for that feature", () => {
    // Landing from another feature, in miniature: `select(featureId, 'chat')`.
    const { result: ws } = renderHook(() => useWorkspace('p1'))
    act(() => ws.current.select('feat_other', 'work'))
    const { result: landing } = renderHook(() => useLandOnChat('feat_a'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LandOnChatProvider value={(id) => ws.current.select(id, 'chat')}>
          {children}
        </LandOnChatProvider>
      ),
    })

    act(() => landing.current())

    expect(ws.current.selectedFeatureId).toBe('feat_a')
    expect(ws.current.featureView).toBe('chat')
    expect(localStorage.getItem('runcastle.feature.tab:feat_a')).toBe('chat')
  })

  it('keeps an open panel view, and its URL segment, when the launch is for the feature on screen', () => {
    // A resume from the switcher while the drive is open: only the chat column changes.
    const { result: ws } = renderHook(() => useWorkspace('p1'))
    act(() => ws.current.select('feat_a', 'drive'))
    const urlBefore = pathFor(
      locationFor({ projectId: 'p1', preparing: false, projectSelected: false, featureSlug: 'a', featureView: 'drive' }),
    )
    const { result: landing } = renderHook(() => useLandOnChat('feat_a'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LandOnChatProvider
          value={(id) =>
            ws.current.select(id, landingView(id, { featureId: ws.current.selectedFeatureId, view: ws.current.featureView }))
          }
        >
          {children}
        </LandOnChatProvider>
      ),
    })

    act(() => landing.current())

    expect(ws.current.featureView).toBe('drive')
    expect(
      pathFor(
        locationFor({
          projectId: 'p1',
          preparing: false,
          projectSelected: false,
          featureSlug: 'a',
          featureView: ws.current.featureView,
        }),
      ),
    ).toBe(urlBefore)
    expect(urlBefore).toMatch(/\/drive$/)
  })

  it('lands on the chat alone for a feature not on screen', () => {
    expect(landingView('feat_a', { featureId: 'feat_other', view: 'design' })).toBe('chat')
    expect(landingView('feat_a', { featureId: null, view: 'design' })).toBe('chat')
    expect(landingView('feat_a', { featureId: 'feat_a', view: 'chat' })).toBe('chat')
    expect(landingView('feat_a', { featureId: 'feat_a', view: 'design' })).toBe('design')
  })

  it('does nothing outside a shell', () => {
    const { result } = renderHook(() => useLandOnChat('feat_a'))
    expect(() => result.current()).not.toThrow()
  })
})

describe('every resolve entry lands on Chat', () => {
  const landed: string[] = []
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LandOnChatProvider value={(id) => landed.push(id)}>{children}</LandOnChatProvider>
  )

  beforeEach(() => {
    landed.length = 0
    state.launches.length = 0
    state.endFails = false
  })
  afterEach(cleanup)

  it('lands once the resolve session has launched', async () => {
    const { result } = renderHook(() => useResolveConflict('feat_a', 'feature/a'), { wrapper })
    await act(() => result.current.resolve(conflict))
    expect(state.launches).toHaveLength(1)
    expect(landed).toEqual(['feat_a'])
  })

  it('lands after the compound too — end the live session, then launch', async () => {
    const { result } = renderHook(() => useResolveConflict('feat_a', 'feature/a'), { wrapper })
    await act(() => result.current.resolve(conflict, 'ses_live'))
    expect(landed).toEqual(['feat_a'])
  })

  it('stays put when the live session could not be ended, since nothing launched', async () => {
    state.endFails = true
    const { result } = renderHook(() => useResolveConflict('feat_a', 'feature/a'), { wrapper })
    await act(() => result.current.resolve(conflict, 'ses_live'))
    expect(state.launches).toHaveLength(0)
    expect(landed).toEqual([])
  })
})

describe('every launch site lands', () => {
  const SRC = join(import.meta.dirname, '../src')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
    })
  // The mutations that open a feature session. The project chat and
  // preparation launch through other routers, and have no Chat tab to land on.
  const LAUNCH = /trpc\.feature\.(launchSession|fixDrive)\.useMutation/
  const rel = (f: string): string => relative(SRC, f).split('\\').join('/')

  it('finds the launch sites it guards', () => {
    const sites = files(SRC).filter((f) => LAUNCH.test(readFileSync(f, 'utf8')))
    expect(sites.map(rel).sort()).toEqual([
      'components/Workspace.tsx',
      'components/bodies/RunBody.tsx',
      'components/review/drive-parts.tsx',
      'lib/use-resolve-conflict.ts',
    ])
  })

  // chat-as-web-components decision 7: a thread opens with no agent behind it,
  // so the bar's Chat door lands on the main thread and launches nothing.
  it('opens the main thread from the Chat door without launching', () => {
    const source = readFileSync(join(SRC, 'components/Workspace.tsx'), 'utf8')
    const door = /const openChat = ([^\n]*)/.exec(source)?.[1] ?? ''
    expect(door).toContain('landOnChat()')
    expect(door).not.toMatch(/launch|mutate/)
  })

  it('calls the land-on-chat operation in every module that launches a feature session', () => {
    const forgetful = files(SRC)
      .filter((f) => {
        const source = readFileSync(f, 'utf8')
        return LAUNCH.test(source) && !/useLandOnChat\(/.test(source)
      })
      .map(rel)
    expect(forgetful).toEqual([])
  })
})
