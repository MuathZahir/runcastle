import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  FEATURE_CHAT,
  featureChatEntries,
  projectChatEntries,
  scenarioChatLabel,
  shownSession,
} from '../src/lib/chat-sessions'
import { projectViewLabel, projectViews } from '../src/lib/feature-ui/panel'
import { SessionSwitcher } from '../src/components/chat/SessionSwitcher'

/**
 * The chat column's session switcher (design-mode decision 9): which
 * conversations the column offers, and which one is in front.
 */
describe('the feature page’s chat sessions', () => {
  it('list the feature chat alone while no errand is live', () => {
    expect(featureChatEntries({ featureLive: null, scenario: null })).toEqual([
      { id: FEATURE_CHAT, label: 'Feature chat', live: false },
    ])
  })

  it('name the feature’s session when it is not the chat itself', () => {
    expect(featureChatEntries({ featureLive: { label: 'Drive fix' }, scenario: null })).toEqual([
      { id: FEATURE_CHAT, label: 'Drive fix', live: true },
    ])
  })

  it('list the scenario chat by its errand while its session is live', () => {
    const entries = featureChatEntries({
      featureLive: { label: 'Feature chat' },
      scenario: { sessionId: 'sess_scn', errand: { kind: 'new' } },
    })
    expect(entries.map((e) => e.label)).toEqual(['Feature chat', 'Scenario chat · New scenario'])
    expect(entries[1]).toEqual({ id: 'sess_scn', label: 'Scenario chat · New scenario', live: true })
    expect(scenarioChatLabel({ kind: 'fix', name: 'Expired coupon' })).toBe('Scenario chat · Fix Expired coupon')
  })
})

describe('the project page’s chat sessions', () => {
  const DAY = 86_400_000
  const now = 40 * DAY
  const rows = [
    { id: 'sess_live', title: 'Audit the journal', status: 'live', createdAt: now - 60_000 },
    { id: 'sess_b', title: 'Streaks idea', status: 'ended', createdAt: now - 2 * DAY },
    { id: 'sess_a', title: null, status: 'ended', createdAt: now - 32 * DAY },
  ]

  it('list the live chat once, first, then the past ones in the list’s order, each with its age', () => {
    expect(projectChatEntries({ liveId: 'sess_live', conversations: rows, now })).toEqual([
      { id: 'sess_live', label: 'Audit the journal', live: true },
      { id: 'sess_b', label: 'Streaks idea · 2d', live: false },
      { id: 'sess_a', label: 'Untitled chat · 32d', live: false },
    ])
  })

  it('tell apart past chats that share a title', () => {
    const untitled = [
      { id: 'sess_1', title: null, status: 'ended', createdAt: now - 60_000 },
      { id: 'sess_2', title: null, status: 'ended', createdAt: now - 32 * DAY },
      { id: 'sess_3', title: null, status: 'ended', createdAt: null },
    ]
    expect(projectChatEntries({ liveId: null, conversations: untitled, now }).map((e) => e.label)).toEqual([
      'Untitled chat · 1m',
      'Untitled chat · 32d',
      'Untitled chat',
    ])
  })

  it('list only the past ones with no chat running', () => {
    expect(projectChatEntries({ liveId: null, conversations: rows.slice(1) }).map((e) => e.id)).toEqual([
      'sess_b',
      'sess_a',
    ])
  })
})

describe('shownSession', () => {
  const entries = featureChatEntries({
    featureLive: null,
    scenario: { sessionId: 'sess_scn', errand: { kind: 'new' } },
  })

  it('shows the one picked while it is listed', () => {
    expect(shownSession(entries, 'sess_scn')?.id).toBe('sess_scn')
  })

  it('hands the column back to the first entry once the picked one is gone', () => {
    expect(shownSession(entries, 'sess_gone')?.id).toBe(FEATURE_CHAT)
    expect(shownSession(entries, null)?.id).toBe(FEATURE_CHAT)
  })
})

describe('the project page’s panel', () => {
  it('offers the drive while one is up and the Notes inbox once there are notes', () => {
    expect(projectViews({ driveActive: false, hasNotes: false })).toEqual([])
    expect(projectViews({ driveActive: true, hasNotes: true })).toEqual(['drive', 'details'])
    expect(projectViewLabel('details')).toBe('Notes')
    expect(projectViewLabel('drive')).toBe('Drive')
  })
})

describe('SessionSwitcher', () => {
  it('reads the conversation in front in the chat strip', () => {
    const html = renderToStaticMarkup(
      createElement(SessionSwitcher, {
        entries: featureChatEntries({
          featureLive: { label: 'Feature chat' },
          scenario: { sessionId: 'sess_scn', errand: { kind: 'new' } },
        }),
        current: 'sess_scn',
        onPick: () => undefined,
      }),
    )
    expect(html).toContain('aria-label="Chat session"')
    expect(html).toContain('Scenario chat · New scenario')
  })
})
