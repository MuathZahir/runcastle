// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlossaryContext, GlossaryDialog } from '../src/components/GlossaryDialog'
import { HelpMenu } from '../src/components/HelpMenu'
import { Term } from '../src/components/Term'
import { GLOSSARY, GLOSSARY_GROUP_LABEL, glossaryEntry } from '../src/lib/glossary'
import { openMenu } from './floating'

/**
 * The Glossary and its three doors (ready-to-publish decisions 9, 16, 17).
 * Tier 2: the dialog and the menu portal, and a hint opens on focus.
 */

const terms = () => screen.getAllByRole('term').map((t) => t.textContent)

describe('GlossaryDialog', () => {
  afterEach(cleanup)

  it('lists every word under its group, with the words it replaced', () => {
    render(<GlossaryDialog open onClose={vi.fn()} />)
    expect(terms()).toEqual(expect.arrayContaining(GLOSSARY.map((e) => e.term)))
    expect(terms()).toHaveLength(15)
    for (const label of Object.values(GLOSSARY_GROUP_LABEL)) expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    expect(screen.getByText('Once called: burn, AFK burn, run, lap')).toBeTruthy()
  })

  it('shows Round when the filter has an old word', () => {
    render(<GlossaryDialog open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Find a word'), { target: { value: 'burn' } })
    expect(terms()).toEqual(['Round', 'Worker'])
  })

  it('marks the word it was opened at', () => {
    render(<GlossaryDialog open focus="held-by" onClose={vi.fn()} />)
    const row = screen.getByText('Held by').closest('[data-term]')
    expect(row?.getAttribute('data-term')).toBe('held-by')
    expect(row?.className).toContain('bg-surface-selected')
    expect(screen.getByText('Round').closest('[data-term]')?.className).not.toContain('bg-surface-selected')
  })
})

describe('Term', () => {
  afterEach(cleanup)

  it('shows its sentence on focus, and its link opens the Glossary at that word', () => {
    const openGlossary = vi.fn()
    render(
      <GlossaryContext.Provider value={openGlossary}>
        <p>
          Two <Term id="round">rounds</Term>
        </p>
      </GlossaryContext.Provider>,
    )
    fireEvent.focus(screen.getByRole('button', { name: 'rounds' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(glossaryEntry('round').definition)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open the glossary' }))
    expect(openGlossary).toHaveBeenCalledWith('round')
  })

  it('offers no link where no Glossary can open', () => {
    render(<Term id="scenario" />)
    fireEvent.focus(screen.getByRole('button', { name: 'scenario' }))
    expect(screen.getByText(glossaryEntry('scenario').definition)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open the glossary' })).toBeNull()
  })
})

describe('HelpMenu', () => {
  afterEach(cleanup)

  it('opens the Glossary and the phone setup', () => {
    const onOpenGlossary = vi.fn()
    const onOpenPhoneSetup = vi.fn()
    render(<HelpMenu onOpenGlossary={onOpenGlossary} onOpenPhoneSetup={onOpenPhoneSetup} />)

    openMenu(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Glossary' }))
    expect(onOpenGlossary).toHaveBeenCalledOnce()

    openMenu(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use runcastle on your phone' }))
    expect(onOpenPhoneSetup).toHaveBeenCalledOnce()
  })

  it('leaves the phone entry out on a phone', () => {
    render(<HelpMenu onOpenGlossary={vi.fn()} />)
    openMenu(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Glossary'])
  })
})
