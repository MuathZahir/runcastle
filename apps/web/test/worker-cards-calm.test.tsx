// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRow } from '@runcastle/core'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { WorkerLinksContext } from '../src/components/chat/thread/FeatureCardItems'
import { AssignmentCard, FeatureHandbackCard, HandbackCard, splitReport } from '../src/components/workers/WorkerParts'
import type { ThreadItem } from '../src/lib/chat-thread'

/**
 * The calmer worker cards (calmer-worker-chats decisions 2, 3, 6, 9, 10, 12):
 * a handback shows its first paragraph and opens the rest in a capped box, the
 * assignment starts folded to its purpose line, and a lead's turn shows the
 * workers it started with their live status. Tier 2: clicks.
 */

afterEach(cleanup)

const REPORT = ['Built the storage half; the tests pass.', '## What I built', '- The schema', '- The migration'].join('\n\n')

describe('a handback report', () => {
  it('cuts at the first blank line', () => {
    expect(splitReport(REPORT)).toEqual({ first: 'Built the storage half; the tests pass.', rest: '## What I built\n\n- The schema\n\n- The migration' })
  })

  it("shows the worker's first paragraph; Show more opens the rest in the capped box, Show less folds it", () => {
    render(
      <HandbackCard
        handback={{ workerId: 'w1', workerLabel: 'Storage', kind: 'on-its-own', summary: REPORT, commits: 2, files: [{ path: 'a.ts' }] }}
        onOpenWorker={() => {}}
      />,
    )
    const card = screen.getByRole('article', { name: /Handback/ })
    expect(card.textContent).toContain('Built the storage half')
    expect(card.textContent).not.toContain('What I built')
    expect(card.querySelector('[data-report-box]')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Show more' }))
    const box = card.querySelector('[data-report-box]') as HTMLElement
    expect(box.textContent).toContain('What I built')
    expect(box.className).toContain('max-h-96')
    expect(box.className).toContain('overflow-y-auto')
    fireEvent.click(within(card).getByRole('button', { name: 'Show less' }))
    expect(card.querySelector('[data-report-box]')).toBeNull()
  })

  it('caps the orchestrator’s feature handback the same way', () => {
    render(<FeatureHandbackCard title="Dark mode" state="Ready to test" summary={REPORT} onOpenFeature={() => {}} />)
    const card = screen.getByRole('article', { name: 'Handback from Dark mode' })
    expect(card.textContent).not.toContain('What I built')
    fireEvent.click(within(card).getByRole('button', { name: 'Show more' }))
    expect(card.querySelector('[data-report-box]')?.textContent).toContain('What I built')
  })

  it('offers no Show more for a one-paragraph report', () => {
    render(<FeatureHandbackCard title="Dark mode" state="Ready" summary="All done." onOpenFeature={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})

describe('the assignment card', () => {
  const assignment = {
    label: 'Design tab tweaks',
    purpose: '',
    kind: 'with-you' as const,
    startedBy: 'lead' as const,
    goal: 'Show the tweaks under the design.\n\nRead first: spec.md',
    doneWhen: 'The human likes it',
    model: 'Opus 5.5',
  }

  it('starts folded to its name and purpose line, falling back to the goal’s first line, and opens on a click', () => {
    render(<AssignmentCard assignment={assignment} />)
    const card = screen.getByRole('region', { name: 'Assignment: Design tab tweaks' })
    expect(card.textContent).toContain('Show the tweaks under the design.')
    expect(card.textContent).not.toContain('Done when')
    fireEvent.click(within(card).getByRole('button', { name: 'Show the assignment: Design tab tweaks' }))
    expect(card.querySelector('[data-assignment-box]')?.textContent).toContain('The human likes it')
  })

  it('shows the purpose line when the lead wrote one', () => {
    render(<AssignmentCard assignment={{ ...assignment, purpose: 'Tweak the design tab' }} />)
    expect(screen.getByRole('region').textContent).toContain('Tweak the design tab')
  })
})

describe("the workers card in a lead's chat", () => {
  const items: ThreadItem[] = [
    { kind: 'user', id: 'u1', text: 'Yes' },
    { kind: 'agent', id: 'a1', text: 'Started both.' },
    {
      kind: 'workers_card',
      id: 'wc',
      rows: [
        { workerId: 'w1', label: 'Storage', purpose: 'Store the reports', kind: 'on-its-own' },
        { workerId: 'w2', label: 'Review', purpose: 'Reads the feature for review', kind: 'review' },
        { workerId: 'w3', label: 'Tab', purpose: 'The tab', kind: 'with-you' },
      ],
    },
  ]
  const row = (id: string, status: WorkerRow['status']) => ({ id, status }) as WorkerRow

  it('reads each row’s live status in plain words and opens its worker’s chat', () => {
    const openWorker = vi.fn()
    render(
      <WorkerLinksContext.Provider value={{ workers: [row('w1', 'handed-back'), row('w2', 'queued'), row('w3', 'needs-you')], openWorker }}>
        <ChatThread items={items} state="idle" actions={{ onEdit: () => {}, onBranch: () => {}, canUndoFiles: true }} footer={null} />
      </WorkerLinksContext.Provider>,
    )
    expect(screen.getByText('Started 3 workers')).toBeTruthy()
    expect(screen.getByText('Handed back')).toBeTruthy()
    expect(screen.getByText('Waiting to start')).toBeTruthy()
    expect(screen.getByText('Waiting on you')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(openWorker).toHaveBeenCalledWith('w2')
  })

  it('draws without a worker list, with no status and no way to open', () => {
    render(<ChatThread items={items} state="idle" actions={{ onEdit: () => {}, onBranch: () => {}, canUndoFiles: true }} footer={null} />)
    expect(screen.getByText('Started 3 workers')).toBeTruthy()
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Storage' })).toBeNull()
  })
})
