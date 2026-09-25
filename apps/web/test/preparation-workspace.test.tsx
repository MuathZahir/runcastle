// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectFinding } from '../src/lib/api'
import { EstablishedFrame, PrepCallToAction } from '../src/components/PreparationWorkspace'

const finding = (overrides: Partial<ProjectFinding> = {}): ProjectFinding =>
  ({
    key: 'verifyCommands',
    value: 'bun run test',
    source: 'session',
    evidence: 'First line\nSecond line\nThird line\nFourth line',
    establishedAt: Date.now(),
    ...overrides,
  }) as ProjectFinding

describe('PreparationWorkspace resting states', () => {
  afterEach(cleanup)

  it('puts prepared actions before the established evidence', () => {
    const { container } = render(
      <PrepCallToAction
        prepared
        preparedAt={Date.now()}
        pending={[]}
        findings={[finding()]}
        staleCount={1}
        starting={false}
        onStart={() => {}}
        onStartFresh={() => {}}
      />,
    )

    const text = container.textContent ?? ''
    expect(text.indexOf('Re-prepare this project')).toBeLessThan(text.indexOf('Prepared '))
    expect(text.indexOf('Prepared ')).toBeLessThan(text.indexOf('Resume'))
    expect(text.indexOf('Resume')).toBeLessThan(text.indexOf('Established'))
  })

  it('uses one sentence to explain each launch state', () => {
    const props = {
      preparedAt: null,
      pending: [] as string[],
      findings: [] as ProjectFinding[],
      staleCount: 0,
      starting: false,
      onStart: () => {},
      onStartFresh: () => {},
    }
    const { rerender } = render(<PrepCallToAction {...props} prepared={false} />)
    expect(
      screen.getByText(
        "Opens a terminal session here with an agent in your own checkout — it runs this repo's commands, records the answers, and asks you the ones only you know.",
      ),
    ).toBeTruthy()

    rerender(<PrepCallToAction {...props} prepared />)
    const explainer = screen.getByText(
      'Resume continues your last preparation conversation; Start fresh opens one that has never seen it — values you typed by hand are never overwritten.',
    )
    // a caption under the actions, not a second paragraph of body copy
    expect(explainer.className).toContain('text-xs')
    expect(explainer.className).toContain('text-text-tertiary')
  })

  it('offers exactly one primary in each state', () => {
    const props = {
      preparedAt: Date.now(),
      pending: ['setupCommand'],
      findings: [] as ProjectFinding[],
      staleCount: 0,
      starting: false,
      onStart: () => {},
      onStartFresh: () => {},
    }
    const { container, rerender } = render(<PrepCallToAction {...props} prepared={false} />)
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Start preparation' }).dataset.variant).toBe('primary')
    // what is still open is a list of rows, not a cloud of pills
    expect(screen.getByText('Setup').closest('[data-list-row]')).toBeTruthy()

    rerender(<PrepCallToAction {...props} prepared />)
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Resume' }).dataset.variant).toBe('primary')
    expect(screen.getByRole('button', { name: 'Start fresh' }).dataset.variant).toBe('secondary')
  })
})

describe('EstablishedFrame', () => {
  afterEach(cleanup)

  it('keeps finding context visible while evidence expands per finding', () => {
    render(<EstablishedFrame findings={[finding()]} />)

    // one closed disclosure per finding: its name and provenance on the summary
    const row = screen.getByText('Verify').closest('details')
    expect(row?.open).toBe(false)
    expect(row?.querySelector('summary')?.textContent).toContain('Verified')
    expect(screen.getByText(/Established in a conversation/)).toBeTruthy()
    const evidence = screen.getByText(/First line/)
    expect(evidence.className).toContain('line-clamp-3')
    // the inset ground is the wrapper's, not the clamped text's
    expect(evidence.className).not.toContain('bg-surface-inset')
    expect(evidence.parentElement?.className).toContain('bg-surface-inset')

    fireEvent.click(screen.getByRole('button', { name: 'Show full evidence for Verify' }))
    expect(evidence.className).not.toContain('line-clamp-3')
    expect(
      screen.getByRole('button', { name: 'Collapse evidence for Verify' }),
    ).toBeTruthy()
  })
})
