import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { parsePath, pathFor, samePage, type AppLocation } from './routes'

/**
 * The one place the app touches `history` (decision 1).
 *
 * The nav hooks stay the owners of navigation state; this projects that state
 * onto the address bar and drives the same setters back when the browser
 * navigates. Nothing else in the app calls `pushState` — which is what keeps
 * the URL from becoming a second source of truth, and what makes "overlays
 * never enter history" a property of the code rather than a convention: the
 * palette, Settings, DocPeek, the Draft form and the read-only phase pin are
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

/** The query key the open chat thread rides under (`/p/x/f/slug?thread=sess_…`). */
const THREAD_PARAM = 'thread'

/** The chat thread the address names, so a reload reopens it; null where it names none. */
export function threadInUrl(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(THREAD_PARAM)
}

/**
 * Whether the address is the page's to read and write. False while the shell
 * is still landing: the page it renders then is a stored guess, which the
 * landing replaces with the page the address names — so the guess must neither
 * take the address's thread nor write its own over it (ticket 29).
 */
export const AddressSettled = createContext(true)

/** {@link useAddressedThread}'s answer. */
export interface AddressedThread<T extends null | undefined> {
  /** The page's pick; `absent` while the address's thread is pending. */
  front: string | T
  pick: (pick: string | T) => void
  /** The address's thread while the page's list has not yet said whether it is this page's. */
  pending: string | null
}

/**
 * The page's pick of chat thread, seeded from the address so a reload or a
 * pasted link opens it — but only once `belongs`, this page's own thread list,
 * vouches for the id. The address can name another page's thread: a new page
 * renders before {@link useHistorySync} has moved the address off the old one,
 * and a pasted link can say anything. Until the list answers (`belongs` null)
 * the id is `pending`, not foreign: the page shows neither its own front nor
 * the id, and sends nothing. A foreign id is then dropped, and
 * {@link useThreadInUrl} writes the page's own front over it. A send can only
 * reach the thread in front, so it can only reach this page's threads.
 */
export function useAddressedThread<T extends null | undefined>(
  absent: T,
  belongs: ((threadId: string) => boolean) | null,
): AddressedThread<T> {
  const settled = useContext(AddressSettled)
  // Undefined: the address is not read yet, for the shell has not landed.
  const [addressed, setAddressed] = useState<string | null | undefined>(() => (settled ? threadInUrl() : undefined))
  const [picked, setPicked] = useState<string | T>(absent)
  if (addressed === undefined && settled) setAddressed(threadInUrl())
  else if (typeof addressed === 'string' && belongs) {
    setAddressed(null)
    if (belongs(addressed)) setPicked(addressed)
  }
  const pick = useCallback((next: string | T) => {
    setAddressed(null)
    setPicked(next)
  }, [])
  const pending = typeof addressed === 'string' ? addressed : null
  return { front: pending !== null ? absent : picked, pick, pending }
}

/**
 * Keep the open chat thread in the address (chat-as-web-components ticket 17),
 * so a reload lands on it. Picking a thread is not navigating: the address is
 * replaced, never pushed, so Back still leaves the page. Rendered under the
 * page, the column's effects run before {@link useHistorySync} moves the
 * address to a new page, so the write waits for that move and lands on the
 * page it belongs to; a page whose column says nothing keeps a clean address.
 * `undefined` — a thread still pending — and a shell still landing write nothing.
 */
export function useThreadInUrl(threadId: string | null | undefined): void {
  const settled = useContext(AddressSettled)
  useEffect(() => {
    if (threadId === undefined || !settled) return
    const write = setTimeout(() => {
      if (threadInUrl() === threadId) return
      const search = threadId ? `?${new URLSearchParams({ [THREAD_PARAM]: threadId })}` : ''
      window.history.replaceState(window.history.state, '', `${currentPath()}${search}`)
    }, 0)
    return () => clearTimeout(write)
  }, [threadId, settled])
}

/**
 * Keep the address bar and `location` in step, both ways.
 *
 * Pass `null` whenever the address is not the caller's to state: a list query
 * still in flight, or an overlay owning the screen. The hook then writes
 * nothing, and the next write once a location returns is a REPLACE — because
 * coming back from "not mine to say" is squaring the address up, not going
 * somewhere. That is what keeps an overlay out of history even when opening it
 * disturbs the navigation flags underneath it (the Draft form clears the pinned
 * project row and any open preparation).
 *
 * Every write after that first one is a push: by then the user has actually
 * navigated.
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
    if (path === null) {
      normalized.current = false
      return
    }
    if (currentPath() !== path) {
      // Going somewhere leaves the open thread behind; squaring up the page
      // the address already names (a view the path left out) keeps it.
      if (normalized.current) window.history.pushState(null, '', path)
      else {
        const keep = location && samePage(parsePath(currentPath()), location) ? window.location.search : ''
        window.history.replaceState(null, '', `${path}${keep}`)
      }
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
