import type { Attachment } from '@runcastle/core'

/**
 * Images waiting to be sent, per thread: held here so they outlive the column
 * that took them, and kept in IndexedDB so they outlive the page, as a thread's
 * typed draft does in localStorage (images are too large for that). Keyed as
 * the draft is. A browser that refuses IndexedDB keeps them in memory only.
 *
 * Module state, as the composer inbox is: there is one browser.
 */

/** An image on its way into a message: shown from a local URL, sent as base64. */
export interface PendingAttachment extends Attachment {
  file: Blob
}

/** What a thread's attachments are kept as: the URL and id are this page's own. */
interface Kept {
  name: string
  file: Blob
}

const DB_NAME = 'runcastle.thread.attachments'
const STORE = 'pending'
const NONE: PendingAttachment[] = []

const held = new Map<string, PendingAttachment[]>()
const loading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

let seq = 0
let opening: Promise<IDBDatabase | null> | undefined

function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

async function readKept(key: string): Promise<Kept[]> {
  const db = await database()
  if (!db) return []
  return new Promise((resolve) => {
    const get = db.transaction(STORE).objectStore(STORE).get(key)
    get.onsuccess = () => resolve((get.result as Kept[] | undefined) ?? [])
    get.onerror = () => resolve([])
  })
}

async function writeKept(key: string, attachments: readonly PendingAttachment[]): Promise<void> {
  const db = await database()
  if (!db) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    if (attachments.length) store.put(attachments.map(({ name, file }): Kept => ({ name, file })), key)
    else store.delete(key)
  } catch {
    // Storage full or refused: they live on in memory only.
  }
}

function put(key: string, next: PendingAttachment[]): void {
  if (next.length) held.set(key, next)
  else held.delete(key)
  for (const listener of [...listeners]) listener()
}

/** A file as a pending attachment, under an id no earlier page's can match. */
export function pendingAttachment(file: Blob, name: string): PendingAttachment {
  return { id: `att${Date.now().toString(36)}${++seq}`, name, src: URL.createObjectURL(file), file }
}

/** What waits at `key` now: a stable value, for `useSyncExternalStore`. */
export function attachmentsAt(key: string): PendingAttachment[] {
  return held.get(key) ?? NONE
}

/** Be told when anything held changes. Returns the unsubscribe. */
export function subscribeAttachments(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Bring back what an earlier page kept at `key`, ahead of anything attached
 * since. Once per key, and before this page's first write there, so it never
 * reads back what this page held already.
 */
export function loadAttachments(key: string): Promise<void> {
  let load = loading.get(key)
  if (!load) {
    load = readKept(key).then((kept) => {
      if (kept.length) put(key, [...kept.map((k) => pendingAttachment(k.file, k.name)), ...attachmentsAt(key)])
    })
    loading.set(key, load)
  }
  return load
}

/** Change what waits at `key`, and keep the result. */
export function updateAttachments(key: string, change: (attachments: PendingAttachment[]) => PendingAttachment[]): void {
  put(key, change(attachmentsAt(key)))
  void loadAttachments(key).then(() => writeKept(key, attachmentsAt(key)))
}

/** A thread got its id: what waited under its unstarted key is its own now. */
export async function moveAttachments(from: string, to: string): Promise<void> {
  await Promise.all([loadAttachments(from), loadAttachments(to)])
  const moving = attachmentsAt(from)
  if (moving.length === 0) return
  updateAttachments(to, (attachments) => [...attachments, ...moving])
  updateAttachments(from, () => [])
}
