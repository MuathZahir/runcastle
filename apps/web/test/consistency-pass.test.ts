import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ticketCount, ticketCountText } from '../src/lib/feature-ui'
import { SidebarFootChrome } from '../src/components/Sidebar'
import * as ui from '../src/ui'

/**
 * The UX audit's consistency pass, pinned: one ticket count, one loading
 * look, and no "Server down" before the server has had a chance to answer.
 */

describe('the one ticket count', () => {
  const t = (over: Partial<{ kind: 'implementation' | 'review'; status: string }>) => ({
    kind: 'implementation' as const,
    status: 'pending',
    ...over,
  })

  it('counts every implementation ticket, never the review step or a waived one', () => {
    const tickets = [
      t({ status: 'done' }),
      t({ status: 'pending' }),
      t({ kind: 'review', status: 'done' }),
      t({ status: 'cancelled' }),
      t({ status: 'done' }),
    ]
    expect(ticketCount(tickets)).toEqual({ done: 2, total: 3 })
  })

  it('pluralises on the total', () => {
    expect(ticketCountText({ done: 1, total: 1 })).toBe('1 of 1 ticket done')
    expect(ticketCountText({ done: 0, total: 3 })).toBe('0 of 3 tickets done')
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
  it('is a neutral dot — never Server down', () => {
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
    expect(html).toContain('data-health-tone="neutral"')
    expect(html).not.toContain('bg-danger')
  })
})
