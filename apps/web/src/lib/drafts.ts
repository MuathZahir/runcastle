import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * The words left unsent in each composer, by where the composer keeps them (a
 * thread id, or an unstarted chat's key). The composer reads and writes here,
 * so a key redraws the composer alone, never the transcript beside it.
 *
 * A draft is saved to the browser's storage a short pause after the last key
 * ({@link SAVE_AFTER_MS}), not on every key; and at once on send, when the
 * composer moves to another thread or goes, and when the page hides. Until it
 * is saved the words are held here, and every read sees them.
 */

const PREFIX = 'runcastle.thread.draft:'

/** How long after the last key a draft is saved. */
export const SAVE_AFTER_MS = 300

/** Words written and not yet saved, by key. */
const unsaved = new Map<string, string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function stored(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

function store(key: string, text: string): void {
  try {
    if (text) localStorage.setItem(PREFIX + key, text)
    else localStorage.removeItem(PREFIX + key)
  } catch {
    // Storage full or refused: the draft lives on in memory only.
  }
}

/** The draft kept under `key`, saved or not. */
export function readDraft(key: string): string {
  return unsaved.get(key) ?? stored(key)
}

/** Save every draft written since the last save, now. */
export function flushDrafts(): void {
  clearTimeout(timer)
  timer = undefined
  for (const [key, text] of unsaved) store(key, text)
  unsaved.clear()
}

/** Save the draft under `key` now, if it waits to be. */
export function flushDraft(key: string): void {
  const text = unsaved.get(key)
  if (text === undefined) return
  unsaved.delete(key)
  store(key, text)
}

/**
 * Put `text` under `key`. Every composer showing that key redraws; the browser's
 * storage is written after a pause, or at once with `now` (words moved between
 * keys, words given back by a failed send).
 */
export function writeDraft(key: string, text: string, now = false): void {
  if (now) {
    unsaved.delete(key)
    store(key, text)
  } else {
    unsaved.set(key, text)
    clearTimeout(timer)
    timer = setTimeout(flushDrafts, SAVE_AFTER_MS)
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// A page closed or put away mid-word keeps the word.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDrafts)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDrafts()
  })
}

/**
 * The draft under `key`, live, and its setter. The draft is saved at once when
 * the key changes (the composer moved to another thread) or the composer goes.
 */
export function useDraft(key: string): [string, (next: string) => void] {
  const read = useCallback(() => readDraft(key), [key])
  const text = useSyncExternalStore(subscribe, read, read)
  const set = useCallback((next: string) => writeDraft(key, next), [key])
  useEffect(() => () => flushDraft(key), [key])
  return [text, set]
}
