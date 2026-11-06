import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { parsePath, pathFor, samePage, type AppLocation } from './routes'

/**
 * The one place the app touches `history` (decision 1).
 *
 * The nav hooks stay the owners of navigation state; this projects that state
 * onto the address bar and drives the same setters back when the browser
 * navigates. Nothing else in the app calls `pushState` — which is what keeps
 * the URL from becoming a second source of truth. Overlays are not places:
 * the palette, Settings, the Draft form and the read-only phase pin are not
 * representable as an {@link AppLocation}, so they cannot reach here. The one
 * exception is the phone, where an open overlay takes a Back step of its own
 * ({@link useBackStep}) at the address already showing.
 */

/** The path the browser is showing — `/` where there is no browser at all. */
export function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

/**
 * What an entry the app pushed carries: the entry before it is the app's too,
 * and `from` is the path it was pushed from, so closing a view can step back
 * to it rather than push it again (phone-fixes decision 2). An overlay's entry
 * also carries `overlay`, the id of the dialog that owns it (decision 3). The
 * state survives a reload, which a count in memory would not.
 */
interface InAppEntry {
  runcastle: true
  from?: string
  overlay?: string
}

function entryState(): Partial<InAppEntry> | null {
  const state: unknown = window.history.state
  return state && typeof state === 'object' ? (state as Partial<InAppEntry>) : null
}

function pushEntry(path: string, extra: { overlay?: string } = {}): void {
  const entry: InAppEntry = { runcastle: true, from: currentPath(), ...extra }
  window.history.pushState(entry, '', path)
}

/**
 * Put `path` in place of the entry showing, keeping what the entry knew of the
 * place behind it: going back a level with nothing of the app's to step back
 * to (a view or a chat opened straight by a link) must not stack the level
 * above, or the next Back would return to the place just left.
 */
function replaceEntry(path: string): void {
  window.history.replaceState(window.history.state, '', path)
}

/** Set by an on-screen Back with nothing of the app's behind it: the move its fallback makes replaces, never pushes. */
let replaceNext = false

/*
 * The app's own steps back. When the app takes an entry of its own off the
 * stack (a closed view stepping back to where it came from, a closed overlay
 * stepping off its entry), the `popstate` that follows is not the human going
 * somewhere: the app already holds the place it lands on. So it is swallowed,
 * and every history write asked for meanwhile waits until it lands — a write
 * made before the step lands would be undone by it (a sheet that closes, then
 * opens a view). `history.back()` is asynchronous, hence the queue.
 */
let stepping = 0
let stepTimer: ReturnType<typeof setTimeout> | undefined
const queued: (() => void)[] = []
/** The app's `popstate` handlers: they hear the human's Back and Forward, never the app's own steps. */
const popListeners = new Set<() => void>()
/** The overlays open now, by the id their history entry carries. */
const liveOverlays = new Set<string>()
let listening = false

function flush(): void {
  while (stepping === 0 && queued.length > 0) queued.shift()?.()
}

function settle(): void {
  stepping = 0
  clearTimeout(stepTimer)
  flush()
}

/** Take the app's own entry off the stack, swallowing the `popstate` it causes. */
function stepOff(): void {
  stepping++
  clearTimeout(stepTimer)
  // A Back with nothing behind fires no `popstate`; never hold the queue for it.
  stepTimer = setTimeout(settle, 1000)
  window.history.back()
}

/** Run a history write now, or once the app's own steps back have landed. */
function whenSettled(write: () => void): void {
  if (stepping === 0) write()
  else queued.push(write)
}

function onPop(): void {
  if (stepping > 0) {
    stepping--
    if (stepping === 0) settle()
    return
  }
  for (const listener of [...popListeners]) listener()
  // Landing on an overlay's entry with no overlay open (Back from a page opened
  // over a closed sheet, Forward into one): the entry is a step to nowhere, so
  // the app steps over it.
  skipOrphanOverlay()
}

function skipOrphanOverlay(): void {
  const overlay = entryState()?.overlay
  if (overlay && !liveOverlays.has(overlay)) stepOff()
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', onPop)
  // A reload over an open overlay comes back with its entry and no overlay.
  skipOrphanOverlay()
}

/** Hear the human's Back and Forward — never the app's own steps back. */
export function onAppPopState(listener: () => void): () => void {
  listen()
  popListeners.add(listener)
  return () => {
    popListeners.delete(listener)
  }
}

/** Add a history entry, so Back comes back to where we were. */
export function pushPath(path: string): void {
  if (typeof window === 'undefined') return
  whenSettled(() => {
    if (currentPath() !== path) pushEntry(path)
  })
}

/**
 * Go to `path` from outside the nav hooks (a desktop ping's click): push it,
 * then let the app's `popstate` listeners route it exactly as they route Back —
 * the outer nav switches project, the project shell opens the feature.
 */
export function goToPath(path: string): void {
  if (typeof window === 'undefined') return
  listen()
  whenSettled(() => {
    if (currentPath() !== path) pushEntry(path)
    for (const listener of [...popListeners]) listener()
  })
}

/**
 * The phone's on-screen Back: the same step as the system's Back, so the two
 * never loop through a page already left. An entry the app did not push (a
 * link opened straight on this page) has nothing of ours behind it, and takes
 * `fallback` rather than leaving the app.
 */
export function backInApp(fallback: () => void): void {
  if (entryState()?.runcastle) whenSettled(() => window.history.back())
  else {
    // Going up a level in place of the link's entry, so Back never comes back down to it.
    replaceNext = true
    fallback()
    // A fallback that moved nothing leaves no mark on the next move.
    setTimeout(() => {
      replaceNext = false
    }, 250)
  }
}

/**
 * Correct the address without adding an entry. Normalizing is not navigating:
 * landing on `/p/x` and resolving that to the feature you were last on is one
 * place, not two, and pushing it would put a Back step in the middle of it.
 */
export function replacePath(path: string): void {
  if (typeof window === 'undefined') return
  whenSettled(() => {
    if (currentPath() !== path) window.history.replaceState(null, '', path)
  })
}

/**
 * Give an overlay one Back step on the phone (phone-fixes decision 3): while
 * `active`, it owns a history entry at the same address, and the system's Back
 * takes that entry and calls `onBack`. `onBack` answers whether the overlay
 * closed: one that asks first (typed text to discard) keeps its entry. Closing
 * any other way steps off the entry, so Back never comes back to it.
 */
export function useBackStep(active: boolean, onBack: () => boolean): void {
  const handler = useRef(onBack)
  useEffect(() => {
    handler.current = onBack
  })
  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    listen()
    const id = Math.random().toString(36).slice(2)
    let pushed = false
    let gone = false
    const push = () =>
      whenSettled(() => {
        if (gone) return
        pushEntry(`${currentPath()}${window.location.search}`, { overlay: id })
        pushed = true
      })
    liveOverlays.add(id)
    push()
    const unlisten = onAppPopState(() => {
      if (!pushed || entryState()?.overlay === id) return
      // Back from a page opened over this overlay lands below its entry too.
      pushed = false
      if (!handler.current()) push()
    })
    return () => {
      gone = true
      unlisten()
      liveOverlays.delete(id)
      if (pushed && entryState()?.overlay === id) stepOff()
    }
  }, [active])
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
    const write = setTimeout(
      () =>
        whenSettled(() => {
          if (threadInUrl() === threadId) return
          const search = threadId ? `?${new URLSearchParams({ [THREAD_PARAM]: threadId })}` : ''
          window.history.replaceState(window.history.state, '', `${currentPath()}${search}`)
        }),
      0,
    )
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
    const normalizing = !normalized.current
    normalized.current = true
    const up = replaceNext
    replaceNext = false
    whenSettled(() => {
      if (currentPath() === path) return
      if (!normalizing) {
        // Closing a view goes back where it came from: when the entry behind
        // is this page at `path`, step back to it rather than push it again,
        // or Back would return to the view just closed (phone-fixes decision 2).
        const from = entryState()?.from
        const here = parsePath(currentPath())
        const sameSpot = !!location && !!here && samePage(here, location)
        if (sameSpot && from === path) stepOff()
        // Closing a view with nothing to step back to (one opened by a link, or
        // over another view), or the on-screen Back's way up from a link: the
        // place it goes takes the entry's place, or Back would loop into it.
        else if (up || (sameSpot && location?.kind === 'feature' && location.view === 'chat')) replaceEntry(path)
        else pushEntry(path)
        return
      }
      // Going somewhere leaves the open thread behind; squaring up the page
      // the address already names (a view the path left out) keeps it.
      const keep = location && samePage(parsePath(currentPath()), location) ? window.location.search : ''
      window.history.replaceState(null, '', `${path}${keep}`)
    })
  }, [path])

  // Held in a ref so the listener is subscribed once rather than re-subscribed
  // on every render of a caller whose handler closes over fresh state.
  const handler = useRef(onPopState)
  useEffect(() => {
    handler.current = onPopState
  })
  useEffect(() => onAppPopState(() => handler.current(parsePath(currentPath()))), [])
}
