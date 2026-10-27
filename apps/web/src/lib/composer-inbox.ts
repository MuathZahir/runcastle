/**
 * Images waiting for a thread's composer (chat-as-web-components decision 5).
 * A Select area crop is taken in the design pane, far from the chat column, and
 * the column for its thread may not even be mounted yet: the crop is put here
 * under the composer's key, the page brings that thread to the front, and the
 * column takes what waits for it when it mounts or is told.
 *
 * Module state, as the one live stream's status is: there is one browser, and a
 * crop is handed across the tree, not down it.
 */

const waiting = new Map<string, File[]>()
const listeners = new Map<string, Set<() => void>>()

/** The inbox of a feature's main chat, which every crop from its design pane goes to. */
export function mainChatInbox(featureId: string): string {
  return `feature:${featureId}:main`
}

/** Leave `files` for the composer at `key`, and tell whoever listens there. */
export function putInInbox(key: string, files: readonly File[]): void {
  if (files.length === 0) return
  waiting.set(key, [...(waiting.get(key) ?? []), ...files])
  for (const listener of [...(listeners.get(key) ?? [])]) listener()
}

/** Everything waiting at `key`, removed from the inbox. */
export function takeFromInbox(key: string): File[] {
  const files = waiting.get(key) ?? []
  waiting.delete(key)
  return files
}

/** Be told when something is put at `key`. Returns the unsubscribe. */
export function subscribeInbox(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(listener)
  listeners.set(key, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}
