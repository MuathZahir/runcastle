import { useCallback, useSyncExternalStore } from 'react'

/**
 * The colour theme (DESIGN.md §Colour): dark is the default, light a full peer.
 *
 * What the human picks is a *preference* — `dark`, `light`, or `system` (follow
 * the OS). What the page paints is the *resolved* theme, always `dark` or
 * `light`, written to `<html data-theme>`; `theme.css` redefines every colour
 * token under `[data-theme="light"]`, so that one attribute re-skins the app.
 *
 * {@link applyStoredTheme} runs at the top of `main.tsx`, before React renders,
 * so the first paint is already the right theme. {@link useTheme} is the hook a
 * toggle uses (the sidebar foot, the command palette, General settings).
 *
 * The preference lives in `localStorage` — a per-browser convenience, not a
 * setting the server needs to know. Every read and write is guarded: storage can
 * be missing or throw (private windows, blocked site data), and the app must
 * still paint, just without remembering.
 */

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'runcastle.theme'
export const DEFAULT_THEME: ThemePreference = 'dark'

const QUERY = '(prefers-color-scheme: light)'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system'
}

/** The stored preference, or the default when there is none (or no storage). */
export function readThemePreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    return isPreference(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return globalThis.matchMedia?.(QUERY).matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** What a preference paints right now. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

let current: ThemePreference = DEFAULT_THEME
const listeners = new Set<() => void>()
let mediaUnsubscribe: (() => void) | null = null

/**
 * Write the resolved theme onto `<html>`. A switch is instant: every element
 * with a colour transition would otherwise cross-fade on its own clock, so for
 * the frame of the switch `data-theme-switching` turns transitions off
 * (theme.css).
 */
function paint(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const next = resolveTheme(current)
  if (root.dataset.theme === next) return
  const switching = root.dataset.theme !== undefined
  if (switching) root.setAttribute('data-theme-switching', '')
  root.dataset.theme = next
  if (switching) {
    const done = () => root.removeAttribute('data-theme-switching')
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done))
    else done()
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** While the preference is `system`, repaint whenever the OS theme flips. */
function followSystem(on: boolean): void {
  if (!on) {
    mediaUnsubscribe?.()
    mediaUnsubscribe = null
    return
  }
  if (mediaUnsubscribe) return
  let media: MediaQueryList | undefined
  try {
    media = globalThis.matchMedia?.(QUERY)
  } catch {
    media = undefined
  }
  if (!media) return
  const onChange = () => {
    paint()
    notify()
  }
  media.addEventListener('change', onChange)
  mediaUnsubscribe = () => media.removeEventListener('change', onChange)
}

/**
 * Read the stored preference and paint it onto `<html>`. Call once, before the
 * first render (top of `main.tsx`). Returns the preference it applied.
 */
export function applyStoredTheme(): ThemePreference {
  current = readThemePreference()
  paint()
  followSystem(current === 'system')
  return current
}

/** Change the preference: remember it, repaint, and tell every `useTheme`. */
export function setThemePreference(preference: ThemePreference): void {
  current = preference
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // No storage: the choice still applies for this page's lifetime.
  }
  paint()
  followSystem(preference === 'system')
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// One snapshot string so React compares by value, not by object identity.
const snapshot = () => `${current}:${resolveTheme(current)}`
const serverSnapshot = () => `${DEFAULT_THEME}:${DEFAULT_THEME}`

/**
 * The theme, for a toggle or a picker.
 *
 * - `preference` — what the human chose (`dark` · `light` · `system`).
 * - `resolved` — what is painted (`dark` · `light`).
 * - `setPreference(p)` — choose one; persisted and applied at once.
 * - `toggle()` — flip the *painted* theme (a `system` preference becomes the
 *   explicit opposite of what the OS currently shows).
 */
export function useTheme(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
} {
  const snap = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const [preference, resolved] = snap.split(':') as [ThemePreference, ResolvedTheme]
  const toggle = useCallback(() => {
    setThemePreference(resolveTheme(current) === 'dark' ? 'light' : 'dark')
  }, [])
  return { preference, resolved, setPreference: setThemePreference, toggle }
}
