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
    expect(explainer.className).toBe('max-w-[52ch] text-sm leading-6 text-text-3')
  })
})

describe('EstablishedFrame', () => {
  afterEach(cleanup)

  it('keeps finding context visible while evidence expands per finding', () => {
    render(<EstablishedFrame findings={[finding()]} />)

    expect(screen.getByText('Verify')).toBeTruthy()
    expect(screen.getByText('verified', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText(/Established in a conversation/)).toBeTruthy()
    const evidence = screen.getByText(/First line/)
    expect(evidence.className).toContain('line-clamp-3')
    expect(evidence.className).not.toContain('py-[5px]')
    expect(evidence.parentElement?.className).toContain('py-[5px]')

    fireEvent.click(screen.getByRole('button', { name: 'Show full evidence for Verify' }))
    expect(evidence.className).not.toContain('line-clamp-3')
    expect(
      screen.getByRole('button', { name: 'Collapse evidence for Verify' }),
    ).toBeTruthy()
  })
})
