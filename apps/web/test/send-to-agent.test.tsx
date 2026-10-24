// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestNote } from '@runcastle/core'

/**
 * "Send to agent" (`the-feature-lead-runs-rounds` decisions 18 and 19). Tier 2:
 * the send is a click that calls `notes.send`, any number of times, and the
 * line beside it follows what the notes say was sent.
 */
const server = vi.hoisted(() => ({
  notes: [] as unknown[],
  sends: [] as unknown[],
  invalidated: 0,
  delivery: undefined as unknown,
}))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      notes: { list: { invalidate: () => (server.invalidated += 1) }, delivery: { invalidate: () => undefined } },
    }),
    notes: {
      list: { useQuery: () => ({ data: server.notes }) },
      delivery: { useQuery: () => ({ data: server.delivery }) },
      send: {
        useMutation: (opts?: { onSuccess?: (r: { sent: number }) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            server.sends.push(input)
            opts?.onSuccess?.({ sent: 0 })
          },
        }),
      },
    },
  } as unknown as typeof import('../src/trpc').trpc,
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { SendToAgent, sendLine, unsentNotes, waitingForAgent } = await import('../src/components/review/SendToAgent')

const NOW = 1_800_000_000_000
const note = (over: Partial<TestNote>): TestNote => ({
  id: 'note_1',
  featureId: 'feat_1',
  text: 'two codes stack',
  status: 'open',
  author: 'human',
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  ...over,
})

describe('what Send to agent would carry', () => {
  it('is the human’s unsent notes, never a promoted one or the review agent’s', () => {
    const notes = [
      note({ id: 'a' }),
      note({ id: 'b', sentAt: NOW - 1000 }),
      note({ id: 'c', status: 'promoted' }),
      note({ id: 'd', author: 'agent' }),
    ]
    expect(unsentNotes(notes).map((n) => n.id)).toEqual(['a'])
  })

  it('says what is waiting, then when it went, and that an empty send means all good', () => {
    expect(sendLine([note({}), note({ id: 'b' })], NOW)).toBe('2 notes not sent yet')
    expect(sendLine([note({ sentAt: NOW - 5 * 60_000 })], NOW)).toBe('Sent 5m ago')
    expect(sendLine([], NOW)).toBe('No notes — sending tells the agent all is good')
  })

  it('never says sent for what no agent has taken yet (decision 28)', () => {
    const queued = { waitingSince: NOW - 60_000, lastFailure: null }
    expect(sendLine([note({ sentAt: NOW - 30_000 })], NOW, queued)).toBe('Sent — waiting for the agent to pick it up')
    // Sent before the oldest waiting message: that one reached the agent.
    expect(sendLine([note({ sentAt: NOW - 5 * 60_000 })], NOW, queued)).toBe('Sent 5m ago')
    expect(waitingForAgent(NOW - 30_000, queued)).toBe(true)
    expect(waitingForAgent(NOW - 30_000, { waitingSince: null, lastFailure: null })).toBe(false)
    expect(waitingForAgent(undefined, queued)).toBe(false)
  })
})

describe('SendToAgent', () => {
  beforeEach(() => {
    server.notes = []
    server.sends = []
    server.invalidated = 0
    server.delivery = undefined
  })
  afterEach(cleanup)

  it('sends with no notes at all, and again, as often as the human likes', () => {
    render(<SendToAgent featureId="feat_1" />)
    const send = screen.getByRole('button', { name: 'Send to agent' })

    fireEvent.click(send)
    fireEvent.click(send)

    expect(server.sends).toEqual([{ featureId: 'feat_1' }, { featureId: 'feat_1' }])
    expect(server.invalidated).toBe(2)
  })

  it('says rounds and the agent’s landings wait while this feature is driven', () => {
    render(<SendToAgent featureId="feat_1" driveActive />)
    expect(screen.getByText('While this drive runs, the agent can’t start a round or land its own edits.')).toBeTruthy()
  })

  it('shows a wake that failed, and that what was sent is still queued', () => {
    server.delivery = { waitingSince: NOW - 60_000, lastFailure: { reason: 'exited (code 1)', at: NOW } }
    render(<SendToAgent featureId="feat_1" />)
    expect(
      screen.getByText(
        'The agent didn’t start (its run exited (code 1)). What you sent is still queued and goes with its next start.',
      ),
    ).toBeTruthy()
  })

  it('says nothing about the drive when none is up', () => {
    render(<SendToAgent featureId="feat_1" />)
    expect(screen.queryByText(/While this drive runs/)).toBeNull()
  })

  it('is the primary only where it is asked to be', () => {
    const { unmount } = render(<SendToAgent featureId="feat_1" />)
    expect(screen.getByRole('button', { name: 'Send to agent' }).getAttribute('data-variant')).toBe('secondary')
    unmount()
    render(<SendToAgent featureId="feat_1" primary />)
    expect(screen.getByRole('button', { name: 'Send to agent' }).getAttribute('data-variant')).toBe('primary')
  })
})
