import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { ConflictCard } from '../src/components/review/ConflictCard'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
import { conflictResolveEnded } from '../src/lib/feature-ui'

/**
 * The alert slot's resident (decisions 30b/30d). Tier 1: everything the card
 * decides is which words and which controls it puts on the page, and the one
 * derivation behind its new state is a pure function tested beside it.
 */
const conflict = { base: 'main', files: ['index.html', 'src/App.tsx'], at: 1_760_000_000_000 }

const render = (props: Partial<Parameters<typeof ConflictCard>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(ConflictCard, {
      branch: 'feature/greetings-pages',
      conflict,
      readonly: false,
      liveSessionId: null,
      resolveEnded: false,
      busy: false,
      onResolve: () => undefined,
      ...props,
    }),
  )

describe('ConflictCard', () => {
  it('states what conflicted, lists the files, and offers the agent', () => {
    const html = render()
    expect(html).toContain('Merge conflict')
    expect(html).toContain('main')
    expect(html).toContain('feature/greetings-pages')
    expect(html).toContain('index.html')
    expect(html).toContain('src/App.tsx')
    expect(html).toContain('Resolve with agent')
  })

  /** A red panel with no date reads as "right now" (findings F8). */
  it('says when the conflict was recorded', () => {
    expect(render()).toContain('recorded ')
  })

  /** Decisions #10: the affordance never hides — with a session live it compounds. */
  it('offers to end a live session on the way in rather than vanishing', () => {
    const html = render({ liveSessionId: 'ses_1' })
    expect(html).toContain('End session &amp; resolve')
    expect(html).toContain('One terminal per feature')
  })

  /** Decision 33a: a history view never launches an agent. */
  it('renders nothing at all under readonly', () => {
    expect(render({ readonly: true })).toBe('')
  })

  describe('after a resolve session ended without landing the merge (decision 30d)', () => {
    it('says so, rather than standing unchanged as if the button did nothing', () => {
      expect(render({ resolveEnded: true })).toContain(
        'The resolve session ended but the merge hasn’t landed — resolve by hand or retry.',
      )
    })

    it('keeps Resolve with agent as the primary — retry lives on the bar', () => {
      const html = render({ resolveEnded: true })
      expect(html).toContain('Resolve with agent')
      expect(html).not.toContain('Retry')
    })

    it('says nothing of the sort while no resolve has been attempted', () => {
      expect(render()).not.toContain('resolve by hand or retry')
    })
  })
})

/**
 * The derivation behind that state. There is no negative event to look for —
 * `merge.resolved` is emitted only when the server's best-effort probe sees the
 * merge landed — so the fact is "a resolve-conflict session ended and no
 * resolution followed".
 */
describe('conflictResolveEnded', () => {
  const sessions = [
    { id: 'ses_resolve', purpose: 'resolve-conflict' as const },
    { id: 'ses_qa' },
  ]
  const event = (id: number, type: string, data?: Record<string, unknown>): EventRow => ({
    id,
    projectId: 'prj_1',
    featureId: 'ftr_1',
    ts: 1_000 + id,
    type,
    message: type,
    ...(data ? { data } : {}),
  })
  const conflicted = event(1, 'merge.conflict', { base: 'main', files: ['index.html'] })
  const resolveEnded = event(2, 'session.ended', { sessionId: 'ses_resolve' })

  it('is false while the resolve session is still open', () => {
    expect(conflictResolveEnded([conflicted], sessions)).toBe(false)
  })

  it('is true once the resolve session has ended with nothing to show for it', () => {
    expect(conflictResolveEnded([conflicted, resolveEnded], sessions)).toBe(true)
  })

  it('ignores the end of a session that was never about the conflict', () => {
    const qaEnded = event(2, 'session.ended', { sessionId: 'ses_qa' })
    expect(conflictResolveEnded([conflicted, qaEnded], sessions)).toBe(false)
  })

  /** A server that restarted under a live resolve terminal ends it this way. */
  it('counts a session the server reconciled at boot as ended', () => {
    const reconciled = event(2, 'session.reconciled', { sessionId: 'ses_resolve' })
    expect(conflictResolveEnded([conflicted, reconciled], sessions)).toBe(true)
  })

  it('is false again once the merge actually landed', () => {
    const resolved = event(3, 'merge.resolved', { sessionId: 'ses_resolve' })
    expect(conflictResolveEnded([conflicted, resolveEnded, resolved], sessions)).toBe(false)
  })

  it('starts over on a fresh conflict — the question is about the current one', () => {
    const again = event(3, 'merge.conflict', { base: 'main', files: ['index.html'] })
    expect(conflictResolveEnded([conflicted, resolveEnded, again], sessions)).toBe(false)
  })

  it('is false after a burn, which retires the conflict the resolve was for', () => {
    const burn = event(3, 'burn.started')
    expect(conflictResolveEnded([conflicted, resolveEnded, burn], sessions)).toBe(false)
  })
})

/**
 * Decision 30e — the bar's layout while this card is up. The conflict state
 * carries the most buttons of any next-step bar (Resolve, Retry Merge & ship,
 * the drive, Iterate, Burn), the actions never shrink, and the copy column took
 * whatever was left — one word per line, in the state that most needs reading.
 * The bar is Tailwind now, so the layout lives in the rendered markup and the
 * markup is what is asserted.
 */
describe('the next-step bar beside the conflict card', () => {
  const bar = renderToStaticMarkup(
    createElement(NextStepBar, {
      ns: {
        kick: 'NEXT STEP',
        title: 'Resolve the merge conflict',
        desc: 'The last merge attempt hit conflicts.',
        primary: { label: 'Resolve the merge conflict', kind: 'resolveConflict' as const },
        secondary: [
          { label: 'Retry Merge & ship', kind: 'merge' as const },
          { label: 'Start test drive', kind: 'testDriveStart' as const },
          { label: 'Iterate', kind: 'iterate' as const },
        ],
        busy: false,
      },
      guidance: true,
      busy: false,
      onAction: () => undefined,
    }),
  )

  it('lets the actions wrap to their own row instead of squeezing the copy', () => {
    expect(bar).toContain('flex-wrap')
  })

  it('keeps the kick, title and description on a readable measure', () => {
    expect(bar).toContain('basis-[26rem]')
  })
})
