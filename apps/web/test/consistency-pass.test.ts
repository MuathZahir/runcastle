import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { phaseFacts, phaseSummary, ticketCount, ticketCountText } from '../src/lib/feature-ui'
import type { FeatureFull } from '../src/lib/api'
import { full } from './fixtures'
import { SidebarFootChrome } from '../src/components/Sidebar'
import * as ui from '../src/ui'

/**
 * The UX audit's consistency pass, pinned: one ticket count, one loading
 * look, and no "Server down" before the server has had a chance to answer.
 */

describe('the one ticket count', () => {
  const t = (over: Partial<{ kind: 'implementation' | 'review'; status: string; lap: number; landedLap: number }>) => ({
    kind: 'implementation' as const,
    status: 'pending',
    lap: 1,
    ...over,
  })

  it('counts every implementation ticket, never the review step or a waived one', () => {
    const tickets = [
      t({ status: 'done' }),
      t({ status: 'pending' }),
      t({ kind: 'review', status: 'done' }),
      t({ status: 'cancelled' }),
      t({ status: 'done', lap: 2 }),
    ]
    expect(ticketCount(tickets)).toEqual({ done: 2, total: 3 })
  })

  it('pluralises on the total', () => {
    expect(ticketCountText({ done: 1, total: 1 })).toBe('1 of 1 ticket done')
    expect(ticketCountText({ done: 0, total: 3 })).toBe('0 of 3 tickets done')
  })

  // The stepper tooltip and the pinned-planning banner read the same count.
  it('is the count the planning phase summary states', () => {
    const base = full({ phase: 'review' })
    const record = {
      ...base,
      feature: { ...base.feature, lap: 2 },
      tickets: [t({ status: 'done' }), t({ lap: 2 }), t({ lap: 2, kind: 'review' }), t({ lap: 2, status: 'cancelled' })],
    } as unknown as FeatureFull
    expect(phaseFacts({ phase: 'planning', full: record, events: [] })).toBe('2 tickets')
    expect(phaseSummary({ phase: 'planning', full: record, events: [] })).toBe('Planning · 2 tickets')
  })
})

describe('the one loading look', () => {
  it('is a skeleton that waits before it fades in', () => {
    const html = renderToStaticMarkup(
      createElement(ui.Skeleton, { label: 'Loading feature…', children: createElement(ui.SkeletonBar, { className: 'h-3' }) }),
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('animation-delay:300ms')
    expect(html).toContain('Loading feature…')
  })

  it('has retired the spinner-and-a-word Loading line', () => {
    expect('Loading' in ui).toBe(false)
  })
})

describe('the server status before the first answer', () => {
  it('says Connecting, neutral — never Server down', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarFootChrome, {
        health: 'connecting',
        origin: 'http://x',
        sandbox: 'docker',
        notify: null,
        theme: 'dark',
        onToggleTheme: () => undefined,
      }),
    )
    expect(html).toContain('Connecting')
    expect(html).not.toContain('Server down')
    expect(html).toContain('whitespace-nowrap')
  })
})
