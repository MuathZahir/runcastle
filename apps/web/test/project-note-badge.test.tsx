// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The open-note count on the sidebar's Project row (project-notes
 * decisions #10).
 *
 * The badge belongs to that row because the row IS the door the pile is read and
 * triaged behind, and it is on every in-project screen. Tier 2 rather than a
 * static render: the count is a query, so the row has to be mounted with one
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
        view="empty"
        selectedFeatureId={null}
        talk={{ state: 'none' } as never}
        onSelect={() => {}}
        onSelectProject={() => {}}
        onNewChat={() => {}}
        onDraft={() => {}}
        onOpenPreparation={() => {}}
      />
    </ToastProvider>,
  )
}

/** The sidebar's Project row — the project home's door. */
const projectRow = () =>
  screen.getAllByRole('button').find((el) => el.textContent?.startsWith('Project'))!

afterEach(() => {
  cleanup()
  count.value = 0
})

describe('the project row’s open-note badge', () => {
  it('counts the notes waiting to be triaged', () => {
    count.value = 4

    rail()

    expect(projectRow().textContent).toBe('Project4')
    expect(screen.getByTitle('4 notes waiting to be triaged')).toBeTruthy()
    // A bare number is not a sentence — the row says what it counts.
    expect(projectRow().getAttribute('title')).toBe('runcastle — 4 open notes')
  })

  it('says "note" of a single one', () => {
    count.value = 1

    rail()

    expect(projectRow().getAttribute('title')).toBe('runcastle — 1 open note')
  })

  it('is hidden at zero — an empty inbox is not news', () => {
    rail()

    expect(screen.queryByTitle(/waiting to be triaged/)).toBeNull()
    expect(projectRow().textContent).toBe('Project')
    expect(projectRow().getAttribute('title')).toMatch(/^Talk to the project/)
  })
})
