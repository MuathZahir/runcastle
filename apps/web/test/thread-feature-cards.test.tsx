// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { FeatureLinksContext, type FeatureLinks } from '../src/components/chat/thread/FeatureCardItems'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadItem } from '../src/lib/chat-thread'
import { listItem, need } from './fixtures'

/**
 * Orchestrator actions and runcastle's lines in a chat
 * (orchestrator-actions-show-as-cards): the fold's `features_card` items and
 * runcastle `user` items with a `display`, drawn with the feature list the
 * sidebar reads and opening a feature as its row does. Tier 2: clicks.
 */

const feature = (id: string, title: string, over: Partial<FeatureListItem> = {}): FeatureListItem => ({
  ...listItem({ id, slug: `${id}-slug`, ...over }),
  title,
})

const FEATURES = [
  feature('f1', 'Dark mode'),
  feature('f2', 'Offline sync', { need: need('plan', 'Plan to approve · the plan is ready') }),
  feature('f3', 'Export to PDF'),
  feature('f4', 'Team invites'),
]

const created = (featureId: string, title: string) => ({ featureId, title, actions: ['created' as const] })

const CARD: ThreadItem = {
  kind: 'features_card',
  id: 'features_card:1',
  rows: [created('f1', 'Dark mode'), created('f2', 'Offline sync'), created('f3', 'Export to PDF'), created('f4', 'Team invites')],
}

function links(features: FeatureListItem[] = FEATURES): FeatureLinks {
  return { features, openFeature: vi.fn() }
}

const thread = (items: ThreadItem[], value: FeatureLinks | null) => (
  <FeatureLinksContext.Provider value={value}>
    <ChatThread items={items} state="idle" footer={null} />
  </FeatureLinksContext.Provider>
)

afterEach(cleanup)

describe('the features card in a thread', () => {
  it('counts the features a turn created, shows each one live, and opens one as its sidebar row does', () => {
    const l = links()
    render(thread([CARD], l))
    expect(screen.getByText('4 features created')).toBeTruthy()
    const rows = screen.getAllByRole('button', { name: /^Open / })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Open Dark mode', 'Open Offline sync', 'Open Export to PDF', 'Open Team invites'])
    expect(rows[0]!.textContent).toContain('In progress')
    expect(rows[1]!.textContent).toContain('Plan to approve')
    fireEvent.click(rows[1]!)
    expect(l.openFeature).toHaveBeenCalledWith('f2')
  })

  it('dims a feature the list no longer holds, by its logged title, and does not open it', () => {
    const l = links(FEATURES.filter((f) => f.id !== 'f3'))
    render(thread([CARD], l))
    expect(screen.getByText('Export to PDF')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Export to PDF' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3)
  })

  it('draws rows without live state or clicks in a chat with no feature list', () => {
    render(thread([CARD], null))
    expect(screen.getByText('Dark mode')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
    expect(screen.queryByText('In progress')).toBeNull()
  })
})

describe("runcastle's lines in a thread", () => {
  const runcastle = (text: string, display?: Extract<ThreadItem, { kind: 'user' }>['display']): ThreadItem => ({
    kind: 'user',
    id: 'u1',
    text,
    from: 'runcastle',
    ...(display ? { display } : {}),
  })

  it('draws news as feature rows by title, the agent text behind "What the agent read"', () => {
    const agentText = 'f2-slug: plan ready. Read it with get_feature_context({ slug: "f2-slug" })'
    const item = runcastle(`[runcastle] ${agentText}`, {
      news: [{ featureId: 'f2', title: 'Offline sync', events: [{ tone: 'needsYou', words: 'Plan ready' }] }],
    })
    const l = links()
    render(thread([item], l))
    const row = screen.getByRole('button', { name: 'Open Offline sync' })
    expect(row.textContent).toContain('Plan ready')
    expect(screen.queryByText(/f2-slug/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'What the agent read' }))
    expect(screen.getByText(agentText)).toBeTruthy()
    fireEvent.click(row)
    expect(l.openFeature).toHaveBeenCalledWith('f2')
  })

  it('draws a kickoff with a summary as one Runcastle line', () => {
    render(thread([runcastle('[runcastle] Proceed with your task: invoke /runcastle:feature', { summary: 'Started this chat to plan the feature by itself' })], links()))
    expect(screen.getByText(/Started this chat to plan the feature by itself/)).toBeTruthy()
    expect(screen.queryByText(/Proceed with your task/)).toBeNull()
  })

  it('draws a line with no display as it always has', () => {
    render(thread([runcastle('[runcastle] Round 2 finished. Everything else follows here.')], links()))
    expect(screen.getByText(/Round 2 finished\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'What the agent read' })).toBeNull()
  })

  it("draws the orchestrator's message in full under its name, and a relayed answer as yours", () => {
    const message = 'Please pick up ticket 3 next.\nThe human wants the export first.'
    render(
      thread(
        [
          runcastle('[runcastle] From the project\'s orchestrator, not the human: …', {
            orchestrator: [
              { text: message, relayed: false },
              { text: 'Yes, ship it.', relayed: true },
            ],
          }),
        ],
        links(),
      ),
    )
    expect(screen.getByText('Orchestrator')).toBeTruthy()
    expect(screen.getByText((_, el) => el?.textContent === message && el.children.length === 0)).toBeTruthy()
    expect(screen.getByText('Yes, ship it.')).toBeTruthy()
    expect(screen.getByText('Your answer, relayed by the orchestrator')).toBeTruthy()
    expect(screen.queryByText(/not the human/)).toBeNull()
  })
})
