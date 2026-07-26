import { Shell } from './components/Shell'
import { useLiveSync } from './lib/live'

/** The runcastle IDE shell (UI-SPEC v2). Single-screen workspace — no routes. */
export function App() {
  // Mounted once here so a single SSE connection serves the whole app; it
  // invalidates queries on server-side changes (lib/live.ts).
  useLiveSync()
  return <Shell />
}
