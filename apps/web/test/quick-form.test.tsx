// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParkDraftMode } from '../src/components/quick/ParkDraftMode'

describe('the Draft door', () => {
  afterEach(cleanup)

  it('states Park a draft in one line and submits trimmed Notes as its brief', () => {
    const onSubmit = vi.fn()
    render(<ParkDraftMode
      title="Slack alerts" slug="slack-alerts" oneLiner="Notify builds" notes="  Keep email out of scope.  "
      duplicate={null} busy={false} ready onTitleChange={() => {}} onOneLinerChange={() => {}}
      onNotesChange={() => {}} onSubmit={onSubmit} onCancel={() => {}}
    />)

    expect(screen.getByText('Write it down now, work it out later. Nothing is cut until you Start it.')).toBeTruthy()
    expect(screen.getByLabelText('Notes (optional — becomes the brief)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Park draft' }))
    expect(onSubmit).toHaveBeenCalledWith('Keep email out of scope.')
  })

  it('has one mode, and a footer that cuts nothing', () => {
    render(<ParkDraftMode
      title="Slack alerts" slug="slack-alerts" oneLiner="" notes=""
      duplicate={null} busy={false} ready onTitleChange={() => {}} onOneLinerChange={() => {}}
      onNotesChange={() => {}} onSubmit={() => {}} onCancel={() => {}}
    />)

    // No tab bar, no ticket rows, no base picker, no burn summary: a draft is
    // parked, so there is no branch to fork from and nothing to review.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add another' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^from / })).toBeNull()
    expect(screen.queryByText(/ticket.? \+ review/)).toBeNull()
    expect(screen.getByText('feature/slack-alerts · draft')).toBeTruthy()
  })
})

/**
 * The card is the Dialog parts — a header, the fields, a footer under a
 * divider — so its rhythm is theirs. What is ours: the fields keep one step
 * between them, and the footer has as much room under its divider as the
 * header has above its title.
 */
describe('the rhythm of the draft card', () => {
  afterEach(cleanup)

  /** The numeric step of a spacing utility on `element` — `gap-4` → 4. */
  const step = (element: Element, prefix: string): number => {
    const name = [...element.classList].find((candidate) => candidate.startsWith(`${prefix}-`))
    return Number(name?.slice(prefix.length + 1))
  }

  const card = () => {
    const { container } = render(<ParkDraftMode
      title="" slug="" oneLiner="" notes="" duplicate={null} busy={false} ready={false}
      onTitleChange={() => {}} onOneLinerChange={() => {}} onNotesChange={() => {}}
      onSubmit={() => {}} onCancel={() => {}}
    />)
    return {
      // The Title label's Field, and the stack that Field sits in.
      fields: container.querySelector('label')!.parentElement!.parentElement!,
      footer: container.querySelector('[class~="border-t"]')!,
    }
  }

  it('puts one step between every field', () => {
    const { fields } = card()
    expect(step(fields, 'gap')).toBe(4)
  })

  it('gives the footer a divider and room under it', () => {
    const { footer } = card()
    expect(footer.className).toContain('border-border-subtle')
    expect(footer.classList.contains('pt-4')).toBe(true)
  })

  it('has one primary, and it is Park draft', () => {
    const { container } = render(<ParkDraftMode
      title="x" slug="x" oneLiner="" notes="" duplicate={null} busy={false} ready
      onTitleChange={() => {}} onOneLinerChange={() => {}} onNotesChange={() => {}}
      onSubmit={() => {}} onCancel={() => {}}
    />)
    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]!.textContent).toContain('Park draft')
  })
})
