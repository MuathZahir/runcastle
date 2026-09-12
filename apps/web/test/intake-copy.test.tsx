// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The intake copy, enforced. Both doors are one click apart on two surfaces —
 * the rail head and the project home — and each surface used to describe the
 * second door as "Quick … no conversation". The door is Draft now, and New is
 * the only way work is born, so the words are pinned here: prose drifts back, a
 * rendering sweep does not (same reasoning as `vocabulary-retired`).
 */

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() } } }),
    feature: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn() }) },
      unarchive: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    project: {
      prep: { useQuery: () => ({ data: { prepared: true, pendingKeys: [], findings: [] } }) },
      list: { useQuery: () => ({ data: [{ id: 'project-1', name: 'Project' }] }) },
    },
  },
}))

const { Sidebar } = await import('../src/components/Sidebar')
const { EmptyWorkspace } = await import('../src/components/ProjectShell')
const { ToastProvider } = await import('../src/lib/toast')

/** The rail head, where the two doors sit side by side. */
const rail = () =>
  render(
    <ToastProvider>
      <Sidebar
        projectId="project-1"
        selectedFeatureId={null}
        projectSelected={false}
        width={300}
        talk={{ state: 'none' } as never}
        onSelect={() => {}}
        onSelectProject={() => {}}
        onNewChat={() => {}}
        onQuickChange={() => {}}
        onOpenPreparation={() => {}}
        onResize={() => {}}
      />
    </ToastProvider>,
  ).container

describe('the two intake doors', () => {
  afterEach(cleanup)

  it('sends features and quick changes through the conversation, on both surfaces', () => {
    expect(rail().querySelector('[title^="New —"]')!.getAttribute('title')).toMatch(
      /conversation.+quick changes.+burn-ready tickets/,
    )
    cleanup()

    render(<EmptyWorkspace onNewChat={() => {}} onQuickChange={() => {}} />)
    expect(screen.getByText(/New is the door for both features and quick changes/)).toBeTruthy()
  })

  it('offers the second door as a place to park an idea, not a shortcut past the chat', () => {
    expect(rail().querySelector('[title^="Draft —"]')!.getAttribute('title')).toBe(
      'Draft — write an idea down now, work it out later',
    )
    cleanup()

    render(<EmptyWorkspace onNewChat={() => {}} onQuickChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Draft' })).toBeTruthy()
    expect(screen.getByText(/Draft writes an idea down now, to work out later/)).toBeTruthy()
  })

  it('describes no door as Quick on either surface', () => {
    // Lower-case "quick changes" is the kind of work New takes, not a door.
    const tooltips = [...rail().querySelectorAll('[title]')].map((node) => node.getAttribute('title'))
    expect(tooltips.length).toBeGreaterThan(1)
    for (const tooltip of tooltips) expect.soft(tooltip).not.toMatch(/\bQuick\b/)
    cleanup()

    const { container } = render(<EmptyWorkspace onNewChat={() => {}} onQuickChange={() => {}} />)
    expect(container.innerHTML).not.toMatch(/\bQuick\b/)
  })
})
