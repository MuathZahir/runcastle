// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PromptDisplay, WorkerRow } from '@runcastle/core'
import { RuncastleDisplay, WorkerLinksContext } from '../src/components/chat/thread/FeatureCardItems'

/**
 * A worker's handback and failure in the lead's chat (interactive-workers
 * decisions 4, 16, 21): runcastle's line to the lead draws the approved
 * handback card, with what the lead did beneath it read off the worker's row,
 * and the failed notice; both open the worker's chat. Tier 2: the links are
 * clicked.
 */

afterEach(cleanup)

const row = (over: Partial<WorkerRow> = {}): WorkerRow => ({
  id: 'w_head',
  featureId: 'feat_1',
  label: 'Header',
  purpose: 'The sidebar header',
  kind: 'with-you',
  goal: null,
  doneWhen: null,
  model: 'claude-opus-5-5',
  runtime: 'claude-code',
  startedBy: 'lead',
  status: 'handed-back',
  failure: null,
  engine: 'docker',
  container: null,
  branch: null,
  featureBranch: 'feature/sidebar-refresh',
  previewPort: null,
  handbackSummary: 'Tightened the header; **the human** wanted the chevron on the left.',
  handbackCommits: ['a1b2c3d Header layout', 'd4e5f6a Chevron'],
  handbackFiles: ['src/Header.tsx', 'src/Header.test.tsx', 'src/theme.css'],
  outcome: null,
  outcomeNote: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
})

const handback = (summary = row().handbackSummary!): PromptDisplay => ({
  handback: {
    workerId: 'w_head',
    label: 'Header',
    kind: 'with-you',
    summary,
    commits: ['a1b2c3d Header layout', 'd4e5f6a Chevron'],
    files: ['src/Header.tsx', 'src/Header.test.tsx', 'src/theme.css'],
    threadId: 'w_head',
  },
})

function draw(display: PromptDisplay, workers: WorkerRow[], openWorker = vi.fn()) {
  render(
    <WorkerLinksContext.Provider value={{ workers, openWorker }}>
      <RuncastleDisplay display={display} agentText="[runcastle] Worker handed back" />
    </WorkerLinksContext.Provider>,
  )
  return openWorker
}

describe('a handback in the lead’s chat', () => {
  it('draws the card: who handed back, its kind, its commits, its summary and its files', () => {
    draw(handback(), [row()])
    const card = screen.getByRole('article', { name: 'Handback from Header' })
    expect(card.textContent).toContain('Header handed back')
    expect(card.textContent).toContain('With you')
    expect(card.textContent).toContain('2 commits')
    expect(card.textContent).toContain('the human')
    expect(card.textContent).toContain('3 files changed')
    // The handback records paths, not line counts: no "+0 −0".
    expect(card.textContent).not.toContain('+0')
  })

  it('says nothing beneath it while the lead has not acted', () => {
    draw(handback(), [row()])
    expect(screen.queryByText('Landed')).toBeNull()
    expect(screen.queryByText('Sent back:')).toBeNull()
    expect(screen.queryByText('Dropped')).toBeNull()
  })

  it('says Landed on the feature branch once the lead landed it', () => {
    draw(handback(), [row({ status: 'landed', outcome: 'landed' })])
    expect(screen.getByText('Landed')).toBeTruthy()
    expect(screen.getByText('feature/sidebar-refresh')).toBeTruthy()
  })

  it('says Sent back with the lead’s note, or Dropped', () => {
    draw(handback(), [row({ status: 'working', outcome: 'sent-back', outcomeNote: 'Keep the old spacing.' })])
    expect(screen.getByText('Sent back:')).toBeTruthy()
    expect(screen.getByText('Keep the old spacing.')).toBeTruthy()
    cleanup()
    draw(handback(), [row({ status: 'dropped', outcome: 'dropped' })])
    expect(screen.getByText('Dropped')).toBeTruthy()
  })

  it('gives an earlier handback of the same worker no outcome: the row holds only the latest one’s', () => {
    draw(handback('The first pass.'), [row({ status: 'landed', outcome: 'landed' })])
    expect(screen.queryByText('Landed')).toBeNull()
  })

  it('opens the worker’s chat from its link', () => {
    const open = draw(handback(), [row()])
    fireEvent.click(screen.getByRole('button', { name: 'Open its chat' }))
    expect(open).toHaveBeenCalledWith('w_head')
  })
})

describe('a failed worker in the lead’s chat', () => {
  it('draws the notice with what failed, and opens the worker’s chat', () => {
    const open = draw({ workerFailed: { workerId: 'w_head', label: 'Header', failure: 'container stopped unexpectedly' } }, [row({ status: 'failed' })])
    expect(screen.getByRole('status').textContent).toContain('Worker “Header” failed: container stopped unexpectedly')
    fireEvent.click(screen.getByRole('button', { name: 'Open its chat' }))
    expect(open).toHaveBeenCalledWith('w_head')
  })
})
