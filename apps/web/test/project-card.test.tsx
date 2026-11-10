// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCard, QuietProject } from '../src/components/ProjectCard'
import { ToastProvider } from '../src/lib/toast'
import { portfolioEntries } from '../src/lib/portfolio'
import type { FeatureListItem } from '../src/lib/api'
import { listItem, need } from './fixtures'
import { openMenu } from './floating'

/**
 * A project on All projects (a-better-way-to-move-between-projects, decision
 * 4): a card for a busy project, a line for a quiet one. Their two mutations
 * are stubbed the way the open screen's are — a client that records what it
 * was asked to do — so the tests drive them the way a user does: open the
 * menu, rename in place, and answer the removal question asked back.
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

const project = { id: 'p1', name: 'runcastle-demo', repoPath: '/home/you/code/runcastle-demo', position: 0 }

const titled = (title: string, over: Partial<FeatureListItem>): FeatureListItem => ({
  ...listItem({ id: title, slug: title.toLowerCase().replace(/ /g, '-'), ...over }),
  title,
})
const waits = (title: string, words = 'Plan to approve') => titled(title, { need: need('plan', words) })
const runs = (title: string) => titled(title, { workersWorking: 1 })

const entryOf = (features: FeatureListItem[]) => portfolioEntries([project], [features])[0]!

const onOpen = vi.fn()
const onOpenFeature = vi.fn()

function card(features: FeatureListItem[] = [waits('Voice notes'), runs('Faster start'), titled('Idle', {})]) {
  return render(
    <ToastProvider>
      <ProjectCard entry={entryOf(features)} onOpen={onOpen} onOpenFeature={onOpenFeature} />
    </ToastProvider>,
  )
}

/** Open the ⋯ menu and choose one of its items. */
function choose(label: string) {
  openMenu(screen.getByRole('button', { name: 'runcastle-demo actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

describe('ProjectCard', () => {
  beforeEach(() => {
    stub.renamed = []
    stub.closed = []
    onOpen.mockClear()
    onOpenFeature.mockClear()
  })
  afterEach(cleanup)

  it('shows the project’s initials, name, path, what waits, and a foot of counts', () => {
    const { container } = card()
    const face = container.querySelector('.card')!
    expect(face.textContent).toContain('RD')
    expect(face.textContent).toContain('runcastle-demo')
    expect(face.textContent).toContain('Voice notes')
    expect(face.textContent).toContain('Plan to approve')
    expect(face.textContent).toContain('1running')
    expect(face.textContent).toContain('3features')

    // The path truncates from its left, where a repo path is least interesting.
    const path = container.querySelector('[dir="rtl"]')
    expect(path?.textContent).toBe('/home/you/code/runcastle-demo')
    expect(path?.className).toContain('truncate')
  })

  it('lists what runs only where nothing waits', () => {
    const { container, unmount } = card()
    expect(container.textContent).not.toContain('Faster start')
    unmount()

    const quietCard = card([runs('Faster start')])
    expect(quietCard.container.textContent).toContain('Faster start')
  })

  it('lists three waiting features, then how many more', () => {
    const { container } = card(['A', 'B', 'C', 'D', 'E'].map((t) => waits(t)))
    expect(screen.queryByTitle('Open D')).toBeNull()
    expect(container.textContent).toContain('and 2 more')
  })

  it('enters the project from its face, and opens a feature from its line', () => {
    card()
    const face = screen.getByTitle('Open runcastle-demo')
    expect(face.tagName).toBe('BUTTON')
    fireEvent.click(face)
    expect(onOpen).toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('Open Voice notes'))
    expect(onOpenFeature).toHaveBeenCalledWith('voice-notes')
  })

  it('offers Rename and Remove from list from its menu', () => {
    card()
    openMenu(screen.getByRole('button', { name: 'runcastle-demo actions' }))
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Rename', 'Remove from list'])
  })

  it('renames in place on Enter, up to the name the server would take', () => {
    card()
    choose('Rename')

    const input = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement
    expect(input.maxLength).toBe(80)
    // While the name is edited, the card is not a button into the project.
    expect(screen.queryByTitle('Open runcastle-demo')).toBeNull()
    fireEvent.change(input, { target: { value: 'demo-2' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(stub.renamed).toEqual([{ projectId: 'p1', name: 'demo-2' }])
  })

  it('reverts the rename on Escape', () => {
    card()
    choose('Rename')

    const input = screen.getByRole('textbox', { name: 'Project name' })
    fireEvent.change(input, { target: { value: 'discard me' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(stub.renamed).toEqual([])
    expect(screen.getByTitle('Open runcastle-demo')).toBeTruthy()
  })

  it('asks before removing, says the repo on disk survives, and backs out on Escape', () => {
    card()
    choose('Remove from list')
    expect(document.body.textContent).toContain('Remove runcastle-demo? The repo on disk is untouched.')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()

    choose('Remove from list')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(stub.closed).toEqual([{ projectId: 'p1' }])
  })
})

describe('QuietProject', () => {
  beforeEach(() => {
    stub.closed = []
    onOpen.mockClear()
  })
  afterEach(cleanup)

  function line() {
    return render(
      <ToastProvider>
        <QuietProject entry={entryOf([titled('Idle', {})])} onOpen={onOpen} />
      </ToastProvider>,
    )
  }

  it('is one line, its initials and name, that enters the project', () => {
    line()
    const row = screen.getByTitle('Open runcastle-demo')
    expect(row.tagName).toBe('BUTTON')
    expect(row.textContent).toBe('RDruncastle-demo')
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalled()
  })

  it('keeps Remove from list behind its menu, asking first', () => {
    line()
    choose('Remove from list')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(stub.closed).toEqual([])
  })
})
