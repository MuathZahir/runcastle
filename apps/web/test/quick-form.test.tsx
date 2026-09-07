// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParkDraftMode } from '../src/components/quick/ParkDraftMode'
import { QuickChangeMode } from '../src/components/quick/QuickChangeMode'
import { defaultBaseBranch, slugPreview } from '../src/lib/feature-ui'

describe('Quick overlay modes', () => {
  afterEach(cleanup)

  it('states Quick change in one line and carries creation details in the footer', () => {
    render(<QuickChangeMode
      title="Darker empty state" duplicate={null} tickets={['Fix the chip']} writtenCount={1}
      slug="darker-empty-state" base="main" branches={['main']} detectedBranch="main"
      busy={false} ready rowRefs={{ current: [] }}
      onTitleChange={() => {}} onTicketChange={() => {}} onAddTicket={() => {}}
      onRemoveTicket={() => {}} onBasePick={() => {}} onSubmit={() => {}} onCancel={() => {}}
    />)

    expect(screen.getByText('Each sentence becomes a ticket; you review, then burn.')).toBeTruthy()
    expect(screen.getByText('feature/darker-empty-state')).toBeTruthy()
    expect(screen.getByRole('button', { name: /from main/ })).toBeTruthy()
    expect(screen.getByText('· 1 ticket + review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create feature' })).toBeTruthy()
    expect(screen.queryByText(/creates its own feature/i)).toBeNull()
  })

  it('defaults an internal checkout to main and accepts another branch pick', () => {
    function ReproForm() {
      const branches = ['main', 'develop']
      const [title, setTitle] = useState('')
      const [tickets, setTickets] = useState([''])
      const [base, setBase] = useState(() =>
        defaultBaseBranch({ current: 'runcastle/project', detected: 'main', branches }),
      )
      const writtenCount = tickets.filter((ticket) => ticket.trim()).length
      const ready = !!title.trim() && writtenCount > 0 && !!base

      return <QuickChangeMode
        title={title} duplicate={null} tickets={tickets} writtenCount={writtenCount}
        slug={slugPreview(title)} base={base} branches={branches} detectedBranch="main"
        busy={false} ready={ready} rowRefs={{ current: [] }}
        onTitleChange={setTitle}
        onTicketChange={(index, value) => setTickets((rows) => rows.map((row, position) => position === index ? value : row))}
        onAddTicket={(after) => setTickets((rows) => [...rows.slice(0, after + 1), '', ...rows.slice(after + 1)])}
        onRemoveTicket={() => {}} onBasePick={setBase}
        onSubmit={() => {}} onCancel={() => {}}
      />
    }

    render(<ReproForm />)
    expect(screen.getByRole('button', { name: /from main/ })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Drive probe alpha' } })
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'First sentence.' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add another' }))
    fireEvent.change(screen.getAllByRole('textbox')[2]!, { target: { value: 'Second sentence.' } })

    expect(screen.getByText('feature/drive-probe-alpha')).toBeTruthy()
    expect(screen.getByText('· 2 tickets + review')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create feature' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /from main/ }))
    fireEvent.click(screen.getByRole('option', { name: 'develop' }))
    expect(screen.getByRole('button', { name: /from develop/ })).toBeTruthy()
  })

  it('states Park a draft in one line and submits trimmed Notes as its brief', () => {
    const onSubmit = vi.fn()
    render(<ParkDraftMode
      title="Slack alerts" slug="slack-alerts" oneLiner="Notify builds" notes="  Keep email out of scope.  "
      duplicate={null} busy={false} ready onTitleChange={() => {}} onOneLinerChange={() => {}}
      onNotesChange={() => {}} onSubmit={onSubmit} onCancel={() => {}}
    />)

    expect(screen.getByText('A row and a title. Nothing is cut until you Start it.')).toBeTruthy()
    expect(screen.getByLabelText('Notes (optional — becomes the brief)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Park it' }))
    expect(onSubmit).toHaveBeenCalledWith('Keep email out of scope.')
  })
})

/**
 * Both modes are the same card — an intro, a stack of fields, a footer under a
 * divider — so both keep the same vertical rhythm. Nothing here lays anything
 * out (happy-dom gives every box 0×0), so what is asserted is the contract that
 * produces the spacing: the steps are compared to each other, not to the
 * literal numbers, which is the whole of what "even" means here.
 */
describe('the rhythm of the quick overlay card', () => {
  afterEach(cleanup)

  /** The numeric step of a spacing utility on `element` — `mt-6` → 6. */
  const step = (element: Element, prefix: string): number => {
    const name = [...element.classList].find((candidate) => candidate.startsWith(`${prefix}-`))
    return Number(name?.slice(prefix.length + 1))
  }

  const card = (mode: 'change' | 'draft') => {
    const { container } = render(mode === 'change' ? <QuickChangeMode
      title="" duplicate={null} tickets={['']} writtenCount={0}
      slug="" base="main" branches={['main']} detectedBranch="main"
      busy={false} ready={false} rowRefs={{ current: [] }}
      onTitleChange={() => {}} onTicketChange={() => {}} onAddTicket={() => {}}
      onRemoveTicket={() => {}} onBasePick={() => {}} onSubmit={() => {}} onCancel={() => {}}
    /> : <ParkDraftMode
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

  for (const mode of ['change', 'draft'] as const) {
    it(`opens the ${mode} fields on the step it puts between them`, () => {
      const { fields } = card(mode)
      expect(step(fields, 'mt')).toBe(step(fields, 'gap'))
    })

    it(`gives the ${mode} footer as much room under the divider as above it`, () => {
      const { footer } = card(mode)
      expect(step(footer, 'pt')).toBe(step(footer, 'mt'))
    })
  }
})
