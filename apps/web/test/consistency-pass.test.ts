import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { lapTicketCount, ticketCountText } from '../src/lib/feature-ui'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
import { SidebarFootChrome } from '../src/components/Sidebar'
import { Loading } from '../src/ui'

/**
 * The UX audit's consistency pass, pinned: one ticket count, Merge & ship in
 * the overflow before review, one loading look, and no "Server down" before
 * the server has had a chance to answer.
 */

describe('the one ticket count', () => {
  const t = (over: Partial<{ kind: 'implementation' | 'review'; status: string; lap: number; landedLap: number }>) => ({
    kind: 'implementation' as const,
    status: 'pending',
    lap: 1,
    ...over,
  })

  it('counts this lap’s implementation tickets, never the review step or a waived one', () => {
    const tickets = [
      t({ status: 'done' }),
      t({ status: 'pending' }),
      t({ kind: 'review', status: 'done' }),
      t({ status: 'cancelled' }),
      t({ status: 'done', lap: 2 }),
    ]
    expect(lapTicketCount(tickets, 1)).toEqual({ done: 1, total: 2 })
  })

  it('follows a ticket promoted into a later lap', () => {
    expect(lapTicketCount([t({ lap: 1, landedLap: 2, status: 'done' })], 2)).toEqual({ done: 1, total: 1 })
  })

  it('pluralises on the total', () => {
    expect(ticketCountText({ done: 1, total: 1 })).toBe('1 of 1 ticket done')
    expect(ticketCountText({ done: 0, total: 3 })).toBe('0 of 3 tickets done')
  })
})

describe('a demoted action on the next-step bar', () => {
  const bar = (demote?: readonly ('merge' | 'chat')[]) =>
    renderToStaticMarkup(
      createElement(NextStepBar, {
        ns: {
          kick: 'NEXT STEP',
          title: 'Review the tickets, then burn.',
          primary: { label: 'Burn 3 tickets', kind: 'burn' },
          secondary: [{ label: 'Merge & ship', kind: 'merge', disabled: 'Nothing has burned yet' }],
          busy: false,
        },
        guidance: false,
        busy: false,
        onAction: () => undefined,
        ...(demote ? { demote } : {}),
      }),
    )

  it('is not a button on the row, and its refusal is not a caption under it', () => {
    const html = bar(['merge'])
    expect(html).not.toContain('Merge &amp; ship</button>')
    expect(html).not.toContain('Nothing has burned yet</span>')
    // It is one click away, in the row's More menu.
    expect(html).toContain('aria-label="More actions"')
    expect(html).toContain('Burn 3 tickets')
  })

  it('stays on the row when nothing demotes it', () => {
    expect(bar()).toContain('Merge &amp; ship</button>')
  })
})

describe('the one loading look', () => {
  it('is a status line that waits before it fades in', () => {
    const html = renderToStaticMarkup(createElement(Loading, null, 'Loading feature…'))
    expect(html).toContain('role="status"')
    expect(html).toContain('animation-delay:300ms')
    expect(html).toContain('Loading feature…')
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
