import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FEATURE_CHAT, featureChatEntries, scenarioChatLabel, shownSession } from '../src/lib/chat-sessions'
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
