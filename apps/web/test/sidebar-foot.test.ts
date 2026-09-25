import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarFootChrome, type SidebarFootState } from '../src/components/Sidebar'

/**
 * The sidebar's foot as it renders — what the retired title bar and status bar
 * used to say (decisions 7, 8; DESIGN.md §Frame). Tier-1 static markup
 * (apps/web/STYLE.md): once its queries have answered the foot is pure markup,
 * which is exactly what `SidebarFootChrome` takes.
 *
 * What is pinned is what it *states*: one health reading that names its
 * origin, the sandbox, and three chrome toggles that are icons with names.
 */
function foot(over: Partial<SidebarFootState> = {}): string {
  return renderToStaticMarkup(
    createElement(SidebarFootChrome, {
      health: 'ok',
      origin: 'http://localhost:4513',
      sandbox: 'docker',
      notify: { state: 'off', title: 'Notify me when agents finish a run', onToggle: () => undefined },
      theme: 'dark',
      onToggleTheme: () => undefined,
      onOpenSettings: () => undefined,
      ...over,
    }),
  )
}

describe('sidebar foot', () => {
  it('states one health reading, in words beside a dot', () => {
    expect(foot()).toContain('data-health="ok"')
    expect(foot()).toContain('>Server<')
    expect(foot({ health: 'reconnecting' })).toContain('Reconnecting')
    expect(foot({ health: 'down' })).toContain('Server down')
    expect(foot({ health: 'down' })).toContain('bg-danger')
  })

  it('names the sandbox the sessions run in', () => {
    expect(foot()).toContain('docker')
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

  it('carries the rows it is handed above the status line', () => {
    const html = foot({ rows: createElement('span', null, '3 running elsewhere') })

    expect(html.indexOf('3 running elsewhere')).toBeLessThan(html.indexOf('data-health'))
  })

  it('never counts the runs of the project it is in', () => {
    expect(foot()).not.toMatch(/\d+ runs?\b/)
  })
})
