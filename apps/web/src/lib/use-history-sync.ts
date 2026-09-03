import { useEffect, useRef } from 'react'
import { parsePath, pathFor, type AppLocation } from './routes'

/**
 * The one place the app touches `history` (decision 1).
 *
 * The nav hooks stay the owners of navigation state; this projects that state
 * onto the address bar and drives the same setters back when the browser
 * navigates. Nothing else in the app calls `pushState` — which is what keeps
 * the URL from becoming a second source of truth, and what makes "overlays
 * never enter history" a property of the code rather than a convention: the
 * palette, Settings, DocPeek, the Quick form and the read-only phase pin are
 * not representable as an {@link AppLocation}, so they cannot reach here.
 */

/** The path the browser is showing — `/` where there is no browser at all. */
export function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

/** Add a history entry, so Back comes back to where we were. */
export function pushPath(path: string): void {
  if (typeof window === 'undefined' || currentPath() === path) return
  window.history.pushState(null, '', path)
}

/**
 * Correct the address without adding an entry. Normalizing is not navigating:
 * landing on `/p/x` and resolving that to the feature you were last on is one
 * place, not two, and pushing it would put a Back step in the middle of it.
 */
export function replacePath(path: string): void {
  if (typeof window === 'undefined' || currentPath() === path) return
  window.history.replaceState(null, '', path)
}

/**
 * Keep the address bar and `location` in step, both ways.
 *
 * Pass `null` while the location is still unknown (a list query in flight) —
 * the hook then writes nothing at all, rather than addressing a half-resolved
 * place and pushing over it a moment later. The FIRST write after that is a
 * replace (the normalization above); every write after it is a push, because by
 * then the user has actually gone somewhere.
 *
 * `onPopState` receives the parsed location, or `null` for a path this app does
 * not own — the caller decides what to do with a stranger.
 */
export function useHistorySync(
  location: AppLocation | null,
  onPopState: (location: AppLocation | null) => void,
): void {
  const path = location ? pathFor(location) : null
  const normalized = useRef(false)

  useEffect(() => {
    if (path === null) return
    if (currentPath() !== path) {
      if (normalized.current) window.history.pushState(null, '', path)
      else window.history.replaceState(null, '', path)
    }
    normalized.current = true
  }, [path])

  // Held in a ref so the listener is subscribed once rather than re-subscribed
  // on every render of a caller whose handler closes over fresh state.
  const handler = useRef(onPopState)
  useEffect(() => {
    handler.current = onPopState
  })
  useEffect(() => {
    const onPop = () => handler.current(parsePath(currentPath()))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
}
