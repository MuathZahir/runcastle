// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../src/components/Shell'
import { ToastProvider } from '../src/lib/toast'

/**
 * What the shell does when the setup doctor throws.
 *
 * The doctor shells out to the host to see what git identity and which coding
 * agents are there, and the shell used to treat it as a prerequisite for
 * showing anything at all: "loading projects…" waited on it as well as on the
 * project list, and a report that never arrived read as "not set up", so a
 * machine whose probes 500'd got onboarding instead of its projects. It is
 * diagnostics — the projects render, and the failure is a banner beside them.
 *
 * tRPC is the wire, so it is stubbed; `doctor` is the mutable fixture the two
 * halves of that story are driven from.
 */

/** What `setup.doctor` answers with — the failure, or a set-up host's report. */
let doctor: { data?: { results: unknown[] }; error?: { message: string } } = {
  error: { message: 'ENOENT: no such file or directory, spawn git' },
}
const refetchDoctor = vi.fn()

/** The options the shell hands `setup.doctor`, captured for the retry policy. */
let doctorOptions: Record<string, unknown> = {}

/** A host the wizard has nothing left to ask: git identity, one ready agent. */
const setUpHost = [
  { id: 'git-identity', status: 'ok', detail: 'You <you@example.com>' },
  { runtime: 'claude-code', check: 'binary', status: 'ok', detail: 'claude 1.0.0' },
  { runtime: 'claude-code', check: 'auth', status: 'ok', detail: 'logged in' },
]

const projects = [
  { id: 'p1', name: 'runcastle', repoPath: '/home/you/code/runcastle' },
  { id: 'p2', name: 'sandcastle', repoPath: '/home/you/code/sandcastle' },
]

vi.mock('../src/lib/live', () => ({
  useLivePoll: () => false as const,
  useLiveStatus: () => 'live',
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useQueries: (build: (t: unknown) => unknown[]) =>
      build({ feature: { list: () => undefined } }).map(() => ({ data: [] })),
    useUtils: () => ({ project: { list: { invalidate: async () => undefined } } }),
    project: {
      list: { useQuery: () => ({ data: projects, isLoading: false }) },
      rename: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      close: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
    setup: {
      doctor: {
        useQuery: (_input: undefined, options: Record<string, unknown>) => {
          doctorOptions = options
          return { ...doctor, isLoading: false, refetch: refetchDoctor }
        },
      },
    },
    // The update banner's own check — nothing to report in these runs.
    system: { checkUpdate: { useQuery: () => ({ data: undefined }) } },
  },
}))

/** The shell as the app mounts it, with the toast host its cards expect. */
function renderShell() {
  render(
    <ToastProvider>
      <Shell />
    </ToastProvider>,
  )
}

describe('Shell with a failing setup doctor', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('runcastle.project.v1', JSON.stringify({ view: 'home' }))
    refetchDoctor.mockClear()
    doctor = { error: { message: 'ENOENT: no such file or directory, spawn git' } }
  })
  afterEach(cleanup)

  it('renders the project list rather than sitting on the loading line', () => {
    renderShell()

    expect(screen.queryByText('loading projects…')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Projects (2)' })).toBeTruthy()
    expect(screen.getByTitle('Open runcastle')).toBeTruthy()
  })

  it('says the checks failed, in a banner beside the projects', () => {
    renderShell()

    const banner = screen.getByText('Setup checks could not run')
    expect(banner).toBeTruthy()
    expect(screen.getByText('ENOENT: no such file or directory, spawn git')).toBeTruthy()
    // Non-blocking: the projects are still on screen behind it, and nothing
    // about it is a dialog to get past.
    expect(screen.getByRole('heading', { name: 'Projects (2)' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('re-runs the checks only when asked, never on a timer', () => {
    renderShell()

    // Nothing automatic: the query is configured not to retry the failure and
    // not to re-fire it when the hook remounts, so the browser cannot end up
    // hammering an endpoint that fails deterministically.
    expect(doctorOptions.retry).toBe(false)
    expect(doctorOptions.retryOnMount).toBe(false)
    expect(refetchDoctor).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Re-run checks' }))
    expect(refetchDoctor).toHaveBeenCalledTimes(1)
  })

  it('keeps the banner off the frame when the checks did run', () => {
    doctor = { data: { results: setUpHost } }
    renderShell()

    expect(screen.queryByText('Setup checks could not run')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Projects (2)' })).toBeTruthy()
  })
})
