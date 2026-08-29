// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCard } from '../src/components/ProjectCard'
import { ToastProvider } from '../src/lib/toast'
import type { ProjectStats } from '../src/lib/projects'

/**
 * A portfolio card (decision 7). Its two mutations are stubbed the way the open
 * screen's are — a client that records what it was asked to do — so the tests
 * can drive the card the way a user does: open the menu, rename in place, and
 * answer the removal question the card asks back.
 */

const stub = vi.hoisted(() => ({
  renamed: [] as { projectId: string; name: string }[],
  closed: [] as { projectId: string }[],
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ project: { list: { invalidate: async () => undefined } } }),
    project: {
      rename: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: { projectId: string; name: string }) => stub.renamed.push(input),
        }),
      },
      close: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: { projectId: string }) => stub.closed.push(input),
        }),
      },
    },
  },
}))

const project = { id: 'p1', name: 'runcastle', repoPath: '/home/you/code/runcastle' }

const stats = (over: Partial<ProjectStats> = {}): ProjectStats => ({
  total: 3,
  needsYou: 1,
  activeRuns: 0,
  shipped: 0,
  health: 'attention',
  ...over,
})

const onOpen = vi.fn()

function card(over: Partial<ProjectStats> = {}) {
  return render(
    <ToastProvider>
      <ProjectCard project={project} stats={stats(over)} loading={false} onOpen={onOpen} />
    </ToastProvider>,
  )
}

/** Open the card's ⋯ menu and choose one of its items. */
function choose(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'runcastle actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

describe('ProjectCard', () => {
  beforeEach(() => {
    stub.renamed = []
    stub.closed = []
    onOpen.mockClear()
  })
  afterEach(cleanup)

  it('says what the project is, and opens it when the face is clicked', () => {
    const { container } = card()

    const face = screen.getByTitle('Open runcastle')
    expect(face.textContent).toContain('runcastle')
    expect(face.textContent).toContain('3')
    expect(face.textContent).toContain('features')
    expect(face.textContent).toContain('needs you')
    expect(face.textContent).toContain('Needs you')

    // The path truncates from its left, where a repo path is least interesting;
    // the name truncates the usual way rather than widening the card.
    const path = container.querySelector('[dir="rtl"]')
    expect(path?.textContent).toBe('/home/you/code/runcastle')
    expect(path?.className).toContain('truncate')
    expect(screen.getByText('runcastle').className).toContain('truncate')

    fireEvent.click(face)
    expect(onOpen).toHaveBeenCalled()
  })

  // The app ships no CSS reset while the legacy sheet lives (STYLE.md), so a
  // <button> with only layout utilities paints the whole card in the user
  // agent's grey behind near-white text.
  it('resets the button the face is, so the card keeps the panel behind it', () => {
    card()

    const face = screen.getByTitle('Open runcastle')
    expect(face.className).toContain('bg-transparent')
    expect(face.className).toContain('border-0')
    expect(face.className).toContain('cursor-pointer')
  })

  it('offers Rename and Remove from list without being hovered', () => {
    card()
    fireEvent.click(screen.getByRole('button', { name: 'runcastle actions' }))

    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Rename',
      'Remove from list',
    ])
  })

  it('renames in place on Enter, up to the name the server would take', () => {
    card()
    choose('Rename')

    const input = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement
    expect(input.maxLength).toBe(80)
    fireEvent.change(input, { target: { value: 'runcastle-2' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(stub.renamed).toEqual([{ projectId: 'p1', name: 'runcastle-2' }])
  })

  it('reverts the rename on Escape', () => {
    card()
    choose('Rename')

    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'discard me' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(stub.renamed).toEqual([])
    expect(screen.getByTitle('Open runcastle').textContent).toContain('runcastle')
  })

  it('asks before removing, and says the repo on disk survives', () => {
    card()
    choose('Remove from list')

    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(document.body.textContent).toContain(
      'Remove runcastle? The repo on disk is untouched.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(stub.closed).toEqual([{ projectId: 'p1' }])
  })

  it('backs out of the question on Cancel and on Escape', () => {
    card()
    choose('Remove from list')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()

    choose('Remove from list')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(stub.closed).toEqual([])
  })

  it('refuses to remove while a run is in flight, and says why', () => {
    card({ activeRuns: 2, health: 'working' })
    choose('Remove from list')

    const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(document.body.textContent).toContain('A run is in flight')

    fireEvent.click(remove)
    expect(stub.closed).toEqual([])
  })
})
