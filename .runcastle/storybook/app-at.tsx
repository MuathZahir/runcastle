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
 */
export function AppAt({ path }: { path: string }) {
  useState(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState(null, '', path)
    return null
  })
  return <App />
}
