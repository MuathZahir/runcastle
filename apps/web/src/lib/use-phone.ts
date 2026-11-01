import { useSyncExternalStore } from 'react'

/**
 * The one switch for the phone view (docs/features/runcastle-on-your-phone):
 * narrow, or short enough to be a phone on its side. An iPad is neither, so it
 * gets the desktop app. Every phone difference reads this rather than a
 * breakpoint of its own, so the app is never half one and half the other.
 */
export const PHONE_QUERY = '(max-width: 767px), (max-height: 499px)'

function media(): MediaQueryList | undefined {
  try {
    return globalThis.matchMedia?.(PHONE_QUERY)
  } catch {
    return undefined
  }
}

function subscribe(changed: () => void): () => void {
  const list = media()
  list?.addEventListener('change', changed)
  return () => list?.removeEventListener('change', changed)
}

/** Whether this screen is a phone, followed live as it turns or resizes. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  )
}
