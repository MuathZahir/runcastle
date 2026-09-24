// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNote } from '@runcastle/core'

/**
 * The project's note inbox (decisions.md #10) and the door that triages it.
 *
 * Tier 2 because almost none of it is a string: the section is a disclosure the
 * human opens, the thumbnail is a click into a portalled dialog, and the four
 * verbs are what they send to the server. The queries and mutations are the true
 * boundary and are the only thing stubbed — every assertion is on what the card
 * shows or on the arguments a click hands the router.
 */

const notes = vi.fn<() => ProjectNote[]>(() => [])
const features = vi.fn<() => { id: string; slug: string; title: string }[]>(() => [])
const editNote = vi.fn()
const deleteNote = vi.fn()
const dismissNote = vi.fn()
const reopenNote = vi.fn()
const invalidate = vi.fn()

vi.mock('../src/trpc', () => {
  const mutation = (mutate: unknown) => () => ({ mutate, isPending: false })
  return {
    trpc: {
      useUtils: () => ({ projectNotes: { invalidate } }),
      projectNotes: {
        list: { useQuery: () => ({ data: notes() }) },
        edit: { useMutation: mutation((...a: unknown[]) => editNote(...a)) },
        delete: { useMutation: mutation((...a: unknown[]) => deleteNote(...a)) },
        dismiss: { useMutation: mutation((...a: unknown[]) => dismissNote(...a)) },
        reopen: { useMutation: mutation((...a: unknown[]) => reopenNote(...a)) },
      },
      feature: { list: { useQuery: () => ({ data: features() }) } },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { NotesCard } = await import('../src/components/project/NotesCard')

function note(over: Partial<ProjectNote> = {}): ProjectNote {
  return {
    id: 'pnote_1',
    projectId: 'proj_1',
    text: 'the crumbs overflow on a long title',
    status: 'open',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...over,
  }
}

function card(over: { onTriage?: () => void; triaging?: boolean } = {}) {
  return render(
    <NotesCard
      projectId="proj_1"
      onTriage={over.onTriage ?? (() => {})}
      triaging={over.triaging ?? false}
    />,
  )
}

const button = (name: RegExp | string) => screen.getByRole('button', { name })

beforeEach(() => {
  notes.mockReturnValue([])
  features.mockReturnValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the Notes card', () => {
  /** A project that has never jotted one has no inbox to explain itself with. */
  it('renders nothing at all until the project has had a note', () => {
    const { container } = card()
    expect(container.innerHTML).toBe('')
  })

  it('lists the open notes newest first, whatever order they arrive in', () => {
    notes.mockReturnValue([
      note({ id: 'pnote_old', text: 'oldest', createdAt: 1 }),
      note({ id: 'pnote_new', text: 'newest', createdAt: 9 }),
    ])
    card()

    const shown = screen.getAllByText(/oldest|newest/).map((n) => n.textContent)
    expect(shown).toEqual(['newest', 'oldest'])
  })

  /** Decisions #17: a list of one-liners, not a settings form. */
  it('shows each open note as one quiet row — its verbs are icons that surface on hover or focus', () => {
    notes.mockReturnValue([note()])
    card()

    const row = screen.getByText('the crumbs overflow on a long title').closest('li')
    expect(row?.className).toMatch(/(^| )group( |$)/)
    for (const name of ['Edit', 'Dismiss', 'Delete']) {
      const verb = button(name)
      // an icon, named for assistive tech and the tooltip, not a bordered word
      expect(verb.textContent).toBe('')
      expect(verb.getAttribute('title')).toBe(name)
      // at rest they are invisible, and the row's hover or keyboard focus shows them
      const tray = verb.parentElement?.className ?? ''
      expect(tray).toContain('opacity-0')
      expect(tray).toContain('group-hover:opacity-100')
      expect(tray).toContain('group-focus-within:opacity-100')
    }
    // Delete turns red only under the pointer
    expect(button('Delete').className).toContain('hover:text-danger')
    expect(button('Delete').className).not.toMatch(/(^| )text-danger/)
    // the time is what the verbs replace
    expect(screen.getByText('the crumbs overflow on a long title').closest('li')?.innerHTML).toContain(
      'group-hover:hidden',
    )
  })

  it('marks a note without a picture with a quiet dot rather than an empty thumbnail', () => {
    notes.mockReturnValue([note()])
    card()
    expect(screen.queryByRole('button', { name: 'the picture attached to this note' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('edits inline — Enter saves, Escape gives the row back — and dismisses and deletes', () => {
    notes.mockReturnValue([note()])
    card()

    fireEvent.click(button('Edit'))
    const input = screen.getByLabelText('edit this note')
    fireEvent.change(input, { target: { value: 'the crumbs overflow at 2 lines' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(editNote).toHaveBeenCalledWith({
      noteId: 'pnote_1',
      text: 'the crumbs overflow at 2 lines',
    })

    // the editor holds the row until the save lands; Escape gives it back untouched
    fireEvent.keyDown(screen.getByLabelText('edit this note'), { key: 'Escape' })
    expect(screen.queryByLabelText('edit this note')).toBeNull()
    expect(screen.getByText('the crumbs overflow on a long title')).toBeTruthy()
    expect(editNote).toHaveBeenCalledTimes(1)

    fireEvent.click(button('Dismiss'))
    expect(dismissNote).toHaveBeenCalledWith({ noteId: 'pnote_1' })
    fireEvent.click(button('Delete'))
    expect(deleteNote).toHaveBeenCalledWith({ noteId: 'pnote_1' })
  })

  it('opens the screenshot in the app when its thumbnail is clicked', () => {
    notes.mockReturnValue([note({ screenshotUrl: '/api/reviews/project-note/pnote_1/screenshot.png' })])
    card()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(button('the picture attached to this note'))

    const shown = screen.getByRole('dialog').querySelector('img')
    expect(shown?.getAttribute('src')).toBe('/api/reviews/project-note/pnote_1/screenshot.png')
  })

  /** The frozen record: where each note went, and the one way back out of it. */
  it('shows each triaged note’s outcome and its feature, and reopens it', () => {
    notes.mockReturnValue([
      note({
        id: 'pnote_2',
        status: 'triaged',
        outcome: '→ new feature *Overflowing crumbs*',
        featureId: 'ftr_1',
      }),
    ])
    features.mockReturnValue([{ id: 'ftr_1', slug: 'overflowing-crumbs', title: 'Overflowing crumbs' }])
    card()

    // one quiet disclosure, closed until the human asks for the record
    const disclosure = screen.getByText('1 triaged').closest('details')
    expect(disclosure?.open).toBe(false)
    expect(screen.getByText('→ new feature *Overflowing crumbs*').closest('details')).toBe(disclosure)
    expect(screen.getByRole('link', { name: 'Overflowing crumbs' }).getAttribute('href')).toBe(
      '/p/proj_1/f/overflowing-crumbs',
    )
    // a triaged note is frozen — the inbox offers no way to change it back
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()

    // Reopen is an icon, revealed the same way the open rows' verbs are
    expect(button('Reopen').textContent).toBe('')
    expect(button('Reopen').parentElement?.className).toContain('group-focus-within:opacity-100')
    fireEvent.click(button('Reopen'))
    expect(reopenNote).toHaveBeenCalledWith({ noteId: 'pnote_2' })
  })

  it('heads the card with the open count, one subtitle line and the Triage door', () => {
    const triage = vi.fn()
    notes.mockReturnValue([note(), note({ id: 'pnote_2', createdAt: 2 })])
    const { container } = card({ onTriage: triage })

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy()
    expect(screen.getByTitle('2 open').textContent).toBe('2')
    expect(screen.getByText('Grouped, questioned and routed in a triage chat.')).toBeTruthy()
    // the explanatory paragraph is gone
    expect(container.querySelector('p')).toBeNull()
    // a violet ghost: New chat keeps the page's one solid accent
    const door = button('Triage 2')
    expect(door.className).toContain('text-accent-hi')
    expect(door.className).not.toContain('bg-accent ')
    fireEvent.click(door)
    expect(triage).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to triage at zero, and drops the count', () => {
    notes.mockReturnValue([note({ status: 'triaged', outcome: 'dismissed' })])
    card()
    expect(button(/^Triage 0$/).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByTitle('0 open')).toBeNull()
  })
})
