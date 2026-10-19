import { useState } from 'react'
import { App } from '../../apps/web/src/App'

/**
 * The whole app — sidebar, topbar, body — standing at one address: the page
 * story's one renderer (docs/features/the-map-shows-every-page-and-its-states,
 * decision 5).
 *
 * The app has no router. It reads `window.location.pathname` once, as it
 * mounts (lib/use-history-sync.ts `currentPath`), and falls back to what
 * localStorage remembers when the address names no project — so before `App`
 * mounts, this clears browser storage and sets the address, the way the app's
 * own tests start it (test/history-sync.test.tsx). Storybook reads its
 * `?id=…` query once at load and only ever rewrites the query after that, so
 * the frame keeps the address it was given.
 *
 * Use it as a page story's `render`, with every query the page makes faked at
 * the network edge — the shell's defaults from `shell-fakes.ts`, plus the
 * page's own:
 *
 * ```tsx
 * const meta = {
 *   title: 'Feature/Review',
 *   render: () => <AppAt path={`/p/${PROJECT_ID}/f/coupon-codes`} />,
 *   parameters: { layout: 'fullscreen', ...withApi({ trpc: withShell({ feature: { get: () => feature } }) }) },
 * } satisfies Meta
 * ```
 *
 * A state with no address (a wizard screen, a dialog, Settings) is reached by
 * the story's `play` step, clicking as a user would, never by setting the
 * app's state.
 *
 * The app fills the viewport: its root and every `h-full` below it (the
 * sidebar's column, the panes that scroll) resolve against `#root`, which
 * styles.css sizes to `height: 100%` under a 100%-tall `html, body`. Storybook
 * mounts into `#storybook-root` instead, which that rule never reaches and
 * which grows with its content, so this wrapper stands in for `#root` — the
 * viewport's definite height, for page stories alone (component stories never
 * render it).
 */
export function AppAt({ path }: { path: string }) {
  useState(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState(null, '', path)
    return null
  })
  return (
    <div style={APP_ROOT}>
      <App />
    </div>
  )
}

/** `#root`'s box in the real app: the viewport, never its content, tall. */
const APP_ROOT = { height: '100vh' } as const
