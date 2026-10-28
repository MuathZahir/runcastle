// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectNav, writeStoredNav } from '../src/lib/use-project-nav'
import type { Project } from '../src/lib/api'

/**
 * Where the shell stands when the project list changes under it (decision 3).
 * The landing rule itself is unit-tested over pure inputs in `projects.test.ts`;
 * what is driven here is the hook re-applying it — the bug being that it only
 * ever ran on load, so removing the last project from the home left the user on
 * an empty "Projects (0)" home that a reload would have replaced with the
 * first-project screen.
 *
 * tRPC is the wire, so it is stubbed; the two queries the landing is decided
 * from answer from these mutable fixtures.
 */

let list: Project[] = []

/** A host the wizard has nothing left to ask: git identity, one ready agent. */
const setUpHost = [
  { id: 'git-identity', status: 'ok', detail: 'You <you@example.com>' },
  { runtime: 'claude-code', check: 'binary', status: 'ok', detail: 'claude 1.0.0' },
  { runtime: 'claude-code', check: 'auth', status: 'ok', detail: 'logged in' },
]

/** The doctor's answer as the hook sees it: in flight until a test gives it one. */
let doctor: { data?: { results: unknown[] }; isLoading: boolean } = { data: { results: setUpHost }, isLoading: false }

vi.mock('../src/trpc', () => ({
  trpc: {
    project: { list: { useQuery: () => ({ data: list, isLoading: false }) } },
    setup: {
      doctor: { useQuery: () => doctor },
    },
  },
}))

const proj = (id: string, name: string): Project =>
  ({ id, name, repoPath: `/home/you/code/${name}` }) as Project

describe('useProjectNav', () => {
  beforeEach(() => {
    localStorage.clear()
    list = []
    doctor = { data: { results: setUpHost }, isLoading: false }
  })

  it('leaves the home for the first-project screen when the last project goes', () => {
    // Standing on the home with one project left — where the switcher's "All
    // projects" puts you.
    writeStoredNav({ view: 'home' })
    list = [proj('p1', 'runcastle')]
    const { result, rerender } = renderHook(() => useProjectNav())
    expect(result.current.view).toBe('home')

    // The card's ⋯ → Remove from list → Remove: the close mutation invalidates
    // project.list, and it comes back empty.
    list = []
    rerender()

    expect(result.current.view).toBe('open')
    expect(result.current.currentProjectId).toBeNull()
  })

  it('stays on the home while any project is still open', () => {
    writeStoredNav({ view: 'home' })
    list = [proj('p1', 'runcastle'), proj('p2', 'sandcastle')]
    const { result, rerender } = renderHook(() => useProjectNav())

    list = [proj('p1', 'runcastle')]
    rerender()

    expect(result.current.view).toBe('home')
  })

  it('falls back off a project closed from another window', () => {
    writeStoredNav({ view: 'project', projectId: 'p2' })
    list = [proj('p1', 'runcastle'), proj('p2', 'sandcastle')]
    const { result, rerender } = renderHook(() => useProjectNav())
    expect(result.current.currentProjectId).toBe('p2')

    list = [proj('p1', 'runcastle')]
    rerender()

    expect(result.current.view).toBe('project')
    expect(result.current.currentProjectId).toBe('p1')
  })
})

/**
 * A cold load does not wait on the setup doctor (chat-as-web-components ticket
 * 32): its probes take seconds where the project list takes milliseconds, and
 * holding the landing held the project and its thread behind them.
 */
describe('the first landing', () => {
  const setupGone = { data: { results: [{ id: 'git-identity', status: 'fail', detail: 'no identity' }] }, isLoading: false }

  beforeEach(() => {
    localStorage.clear()
    // A bare launch: an address naming a project would outrank what is stored.
    history.replaceState(null, '', '/')
    list = [proj('p1', 'runcastle'), proj('p2', 'sandcastle')]
    writeStoredNav({ view: 'project', projectId: 'p2' })
  })

  /** A load whose doctor answered set up, so the next one knows the host. */
  function earlierLoadFoundSetUp() {
    doctor = { data: { results: setUpHost }, isLoading: false }
    renderHook(() => useProjectNav()).unmount()
  }

  it('lands in the project at once while the doctor is still probing, on a host set up before', () => {
    earlierLoadFoundSetUp()
    doctor = { isLoading: true }
    const { result } = renderHook(() => useProjectNav())
    expect(result.current.loading).toBe(false)
    expect(result.current.view).toBe('project')
    expect(result.current.currentProjectId).toBe('p2')
  })

  it('waits for the doctor on a host it has never seen set up', () => {
    doctor = { isLoading: true }
    const { result } = renderHook(() => useProjectNav())
    expect(result.current.loading).toBe(true)
  })

  it('goes to the wizard when the fresh doctor finds setup gone', () => {
    earlierLoadFoundSetUp()
    doctor = { isLoading: true }
    const { result, rerender } = renderHook(() => useProjectNav())
    expect(result.current.view).toBe('project')

    doctor = setupGone
    rerender()
    expect(result.current.view).toBe('setup')
  })

  it('stays where the user moved to when the fresh doctor finds setup gone', () => {
    earlierLoadFoundSetUp()
    doctor = { isLoading: true }
    const { result, rerender } = renderHook(() => useProjectNav())
    act(() => result.current.enterProject('p1'))

    doctor = setupGone
    rerender()
    expect(result.current.currentProjectId).toBe('p1')
  })
})
