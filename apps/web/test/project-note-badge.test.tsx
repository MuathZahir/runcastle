// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The open-note count on the sidebar's Orchestrator card (project-notes
 * decisions #10), said in words on its second line.
 *
 * The count belongs to that card because it IS the door the pile is read and
 * triaged behind, and it is on every in-project screen. Tier 2 rather than a
 * static render: the count is a query, so the card has to be mounted with one
 * answered — and hiding at zero is the half of the rule a rendered string with a
 * count in it would never catch.
 */

const count = vi.hoisted(() => ({ value: 0 }))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
    useQueries: () => [],
    events: { listByProject: { useQuery: () => ({ data: undefined }) } },
    feature: {
      testDrive: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn() }) },
      unarchive: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    project: {
      prep: { useQuery: () => ({ data: { prepared: true, pendingKeys: [], findings: [] } }) },
      list: { useQuery: () => ({ data: [{ id: 'project-1', name: 'runcastle' }] }) },
    },
    projectNotes: { openCount: { useQuery: () => ({ data: count.value }) } },
    thread: {
      list: { useQuery: () => ({ data: [] }) },
      // The sidebar thread rows' Rename (threads-in-the-sidebar decision 5).
      rename: { useMutation: () => ({ mutate: () => {} }) },
    },
  },
}))

const { Sidebar } = await import('../src/components/Sidebar')

const nav = {
  projects: [{ id: 'project-1', name: 'runcastle', repoPath: '/repo' }],
  loading: false,
  doctorError: null,
  recheckDoctor: () => {},
  view: 'project' as const,
  currentProjectId: 'project-1',
  currentProject: { id: 'project-1', name: 'runcastle', repoPath: '/repo' },
  goHome: () => {},
  enterProject: () => {},
  showOpen: () => {},
  cancelOpen: () => {},
}
const { ToastProvider } = await import('../src/lib/toast')

function rail() {
  return render(
    <ToastProvider>
      <Sidebar
        projectId="project-1"
        nav={nav}
        view="feature"
        selectedFeatureId={null}
        onSelect={() => {}}
        onSelectProject={() => {}}
        onNewChat={() => {}}
        onDraft={() => {}}
        onOpenPreparation={() => {}}
      />
    </ToastProvider>,
  )
}


/** The sidebar's Orchestrator card — the project chat's door. */
const orchestrator = () => screen.getByRole('button', { name: /^Orchestrator/ })

afterEach(() => {
  cleanup()
  count.value = 0
})

describe('the Orchestrator card’s open-note count', () => {
  it('counts the notes waiting to be triaged', () => {
    count.value = 4

    rail()

    expect(orchestrator().textContent).toBe('OrchestratorPlan, cut and ask · 4 notes')
  })

  it('says "note" of a single one', () => {
    count.value = 1

    rail()

    expect(orchestrator().textContent).toContain('· 1 note')
  })

  it('is left out at zero — an empty pile is not news', () => {
    rail()

    expect(orchestrator().textContent).toBe('OrchestratorPlan, cut and ask')
  })
})

describe('the Orchestrator card’s hover text (one-orchestrator-no-mode decision 1)', () => {
  it('says what the project chat is and that it acts without asking, notes or none', () => {
    const sentence =
      "Your project's orchestrator: it plans, starts, messages and merges features when you ask, and edits this repo and runs commands without asking."
    rail()
    expect(orchestrator().getAttribute('title')).toBe(sentence)
    cleanup()

    count.value = 3
    rail()
    expect(orchestrator().getAttribute('title')).toBe(sentence)
  })
})
