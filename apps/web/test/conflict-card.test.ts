import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
import {
  conflictResolveEnded,
  mergeConflictResolved,
  unresolvedMergeConflict,
} from '../src/lib/feature-ui'

/**
 * The derivations behind the merge conflict's standing row on the chat's
 * notice strip (decisions 30b/30d; the-feature-s-right-panel decision 21).
 *
 * Whether a resolve session ended without landing. There is no negative event to look for —
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

describe('mergeConflictResolved', () => {
  const event = (id: number, type: string): EventRow => ({
    id,
    projectId: 'prj_1',
    featureId: 'ftr_1',
    ts: 1_000 + id,
    type,
    message: type,
    ...(type === 'merge.conflict' ? { data: { base: 'main', files: ['index.html'] } } : {}),
  })

  it('is true once merge.resolved follows the conflict — and the card has cleared', () => {
    const events = [event(1, 'merge.conflict'), event(2, 'merge.resolved')]
    expect(mergeConflictResolved(events)).toBe(true)
    expect(unresolvedMergeConflict(events)).toBeNull()
  })

  it('is false while the conflict still stands', () => {
    expect(mergeConflictResolved([event(1, 'merge.conflict')])).toBe(false)
  })

  it('is false with no conflict ever recorded', () => {
    expect(mergeConflictResolved([event(1, 'merge.resolved')])).toBe(false)
  })

  it('is false again on a fresh conflict, or once a burn or a ship moved on', () => {
    const resolved = [event(1, 'merge.conflict'), event(2, 'merge.resolved')]
    expect(mergeConflictResolved([...resolved, event(3, 'merge.conflict')])).toBe(false)
    expect(mergeConflictResolved([...resolved, event(3, 'burn.started')])).toBe(false)
    expect(mergeConflictResolved([...resolved, event(3, 'feature.shipped')])).toBe(false)
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

  it('keeps the sentence on a readable measure before the actions wrap', () => {
    expect(bar).toContain('basis-80')
  })
})
