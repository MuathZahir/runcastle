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

    expect(screen.getByText('A row and a title. Nothing is cut until you Start it.')).toBeTruthy()
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
 * The card is an intro, a stack of fields, and a footer under a divider, and it
 * keeps one vertical rhythm throughout. Nothing here lays anything out
 * (happy-dom gives every box 0×0), so what is asserted is the contract that
 * produces the spacing: the steps are compared to each other, not to the
 * literal numbers, which is the whole of what "even" means here.
 */
describe('the rhythm of the draft card', () => {
  afterEach(cleanup)

  /** The numeric step of a spacing utility on `element` — `mt-6` → 6. */
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
      footer: container.querySelector('[class*="border-t"]')!,
    }
  }

  it('opens the fields on the step it puts between them', () => {
    const { fields } = card()
    expect(step(fields, 'mt')).toBe(step(fields, 'gap'))
  })

  it('gives the footer as much room under the divider as above it', () => {
    const { footer } = card()
    expect(step(footer, 'pt')).toBe(step(footer, 'mt'))
  })
})
