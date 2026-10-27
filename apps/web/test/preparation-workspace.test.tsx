// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrepView, ProjectFinding } from '../src/lib/api'
import { fakeTrpc } from './fake-trpc'

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { EstablishedFrame, PrepAside, PreparationWorkspace, prepHint } = await import('../src/components/PreparationWorkspace')

const finding = (overrides: Partial<ProjectFinding> = {}): ProjectFinding =>
  ({
    key: 'verifyCommands',
    value: 'bun run test',
    source: 'session',
    evidence: 'First line\nSecond line\nThird line\nFourth line',
    establishedAt: Date.now(),
    ...overrides,
  }) as ProjectFinding

/** The project's server with no preparation chat yet. */
function server(view: Partial<PrepView>) {
  return fakeTrpc({
    'project.list': () => [{ id: 'proj_1', name: 'Demo' }],
    'project.prep': () => ({ prepared: false, preparedAt: null, pendingKeys: [], findings: [], ...view }),
    'project.prepSession': () => null,
    'project.talkToPrep': () => ({ sessionId: 'th_prep' }),
    'thread.list': () => [],
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': () => ({ events: [] }),
    'thread.send': () => ({ promptId: 'p1' }),
  })
}

describe('the preparation workspace', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('is the preparation thread, empty with its composer before anyone started it — no Start, Resume or End session', async () => {
    const api = server({ pendingKeys: ['setupCommand'] })
    render(<PreparationWorkspace projectId="proj_1" />, { wrapper: api.Wrapper })

    expect(screen.getByRole('region', { name: 'Preparation chat' })).toBeTruthy()
    expect(screen.getByLabelText('Message')).toBeTruthy()
    expect(await screen.findByText('1 to establish')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start preparation|Resume|Start fresh|End session/ })).toBeNull()
  })

  it('starts the preparation chat through talkToPrep on the first Send, then sends the message to it', async () => {
    const api = server({})
    render(<PreparationWorkspace projectId="proj_1" />, { wrapper: api.Wrapper })

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The dev server is bun run dev' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    expect(await screen.findByText('The dev server is bun run dev')).toBeTruthy()
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_prep', text: 'The dev server is bun run dev' }]))
    expect(api.inputs('project.talkToPrep')).toEqual([{ projectId: 'proj_1', holdOpening: true }])
  })
})

describe('PrepAside', () => {
  afterEach(cleanup)

  it('lists what is still open as rows, then what is established', () => {
    const { container } = render(<PrepAside pending={['setupCommand']} findings={[finding()]} staleCount={0} />)
    // what is still open is a list of rows, not a cloud of pills
    expect(screen.getByText('Setup').closest('[data-list-row]')).toBeTruthy()
    const text = container.textContent ?? ''
    expect(text.indexOf('Setup')).toBeLessThan(text.indexOf('Verify'))
  })

  it('says in the empty thread what preparation does, in each state', () => {
    expect(prepHint(false)).toContain('asks you the ones only you know')
    expect(prepHint(true)).toContain('values you typed by hand are never overwritten')
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
