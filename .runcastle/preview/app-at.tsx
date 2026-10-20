import { useState } from 'react'
import { App } from '../../apps/web/src/App'

/**
 * The whole app — sidebar, topbar, body — standing at one address.
 *
 * The app has no router. It reads `window.location.pathname` once, as it
 * mounts (lib/use-history-sync.ts `currentPath`), and falls back to what
 * localStorage remembers when the address names no project — so before `App`
 * mounts, this clears browser storage and sets the address, the way the app's
 * own tests start it (test/history-sync.test.tsx).
 *
 * Render it with every query the page makes faked at the network edge — the
 * shell's defaults from `shell-fakes.ts`, plus the page's own. A state with no
 * address (a wizard screen, a dialog, Settings) is reached by clicking as a
 * user would, never by setting the app's state.
 *
 * The app fills the viewport: its root and every `h-full` below it resolve
 * against `#root`, which styles.css sizes to `height: 100%`. A host that mounts
 * elsewhere gets this wrapper standing in for `#root`: the viewport's definite
 * height.
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
