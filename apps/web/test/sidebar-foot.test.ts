// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SidebarFootChrome, type SidebarFootState } from '../src/components/Sidebar'
import { DriveCard } from '../src/components/SidebarParts'
import { TooltipProvider } from '../src/ui/tooltip'

/**
 * The sidebar's foot as it renders — what the retired title bar and status bar
 * used to say (decisions 7, 8; DESIGN.md §Frame). Tier-1 static markup
 * (apps/web/STYLE.md): once its queries have answered the foot is pure markup,
 * which is exactly what `SidebarFootChrome` takes. The one exception is the
 * health tooltip, which exists only while it is open.
 *
 * What is pinned is what it *states*: one line of icons — settings, theme,
 * notifications, then the sandbox and the health dot — with the words in the
 * tooltips, and the drive cards above it.
 */
const STATE: SidebarFootState = {
  health: 'ok',
  origin: 'http://localhost:4513',
  sandbox: 'docker',
  notify: { state: 'off', title: 'Notify me when agents finish a run', onToggle: () => undefined },
  theme: 'dark',
  onToggleTheme: () => undefined,
  onOpenSettings: () => undefined,
}

function foot(over: Partial<SidebarFootState> = {}): string {
  return renderToStaticMarkup(createElement(SidebarFootChrome, { ...STATE, ...over }))
}

afterEach(cleanup)

describe('sidebar foot', () => {
  it('states one health reading as a dot, toned by the server’s health', () => {
    expect(foot()).toContain('data-health-tone="success"')
    expect(foot({ health: 'reconnecting' })).toContain('data-health-tone="warning"')
    expect(foot({ health: 'down' })).toContain('data-health-tone="danger"')
    expect(foot({ health: 'down' })).toContain('bg-danger')
  })

  it('is icons only: no words on the line', () => {
    const html = foot()
    expect(html).not.toContain('>Server<')
    expect(html).not.toContain('>docker<')
  })

  it('says the health in words, with its origin and the sandbox, in the tooltip', async () => {
    render(createElement(TooltipProvider, null, createElement(SidebarFootChrome, { ...STATE, health: 'down' })))
    const health = document.querySelector<HTMLElement>('[data-health-tone]')!
    await act(async () => fireEvent.focus(health))
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'The runcastle API at http://localhost:4513/api is not answering · agents run sandboxed via docker',
    )
  })

  it('gives notifications, theme and settings each a named icon button', () => {
    const html = foot()

    expect(html).toContain('aria-label="Notifications off — turn on"')
    expect(html).toContain('aria-label="Switch to light theme"')
    expect(html).toContain('aria-label="Settings"')
  })

  it('names the theme the toggle would switch to', () => {
    expect(foot({ theme: 'light' })).toContain('aria-label="Switch to dark theme"')
  })

  it('says why notifications cannot be turned on when the browser blocked them', () => {
    const html = foot({
      notify: { state: 'blocked', title: 'Your browser has blocked notifications', onToggle: () => undefined },
    })

    expect(html).toContain('aria-label="Your browser has blocked notifications"')
  })

  it('leaves out what the screen has no use for', () => {
    const html = foot({ notify: null, onOpenSettings: undefined })

    expect(html).not.toContain('Notifications')
    expect(html).not.toContain('aria-label="Settings"')
  })

  it('carries the drive cards it is handed above the status line', () => {
    const html = foot({
      rows: createElement(DriveCard, {
        label: 'Test drive',
        detail: 'Coupons',
        onStop: () => undefined,
      }),
    })

    expect(html.indexOf('Test drive')).toBeLessThan(html.indexOf('data-health-tone'))
    expect(html).toContain('>Coupons<')
    expect(html).toContain('aria-label="Stop the test drive"')
  })

  it('never counts runs — here or elsewhere', () => {
    expect(foot()).not.toMatch(/\d+ runs?\b|running elsewhere/)
  })
})
