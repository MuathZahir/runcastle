import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { Context, ReactNode } from 'react'

/**
 * A value the open page publishes for something beside it (the sidebar, the
 * palette), held in a store rather than in context state.
 *
 * The page publishes on every render, a fresh object each time. Kept in a
 * provider's state, each publish changed a context value above the whole page,
 * and React then walked every fiber under it, the whole chat included, looking
 * for readers: in a long chat with an agent streaming, that walk was the
 * largest cost of each streamed chunk (a-faster-web-app). The store's identity
 * never changes, so a publish wakes only the readers that subscribed.
 */
export interface PublishedStore<T> {
  get: () => T | null
  set: (value: T | null) => void
  subscribe: (listener: () => void) => () => void
}

function createStore<T>(initial: T | null): PublishedStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export interface Published<T> {
  /** Under the project shell: holds what the page publishes. */
  Provider: (props: { children: ReactNode }) => ReactNode
  /** A fixed value, for a reader rendered on its own (a test). */
  Value: (props: { value: T | null; children: ReactNode }) => ReactNode
  /** The page's side: publish on every render, withdraw on unmount. */
  usePublish: (value: T | null) => void
  /** The reader's side: what the page published, or null. */
  useValue: () => T | null
}

export function createPublished<T>(): Published<T> {
  // Outside any provider a publish goes nowhere and a read is null, as before.
  const nowhere: PublishedStore<T> = { get: () => null, set: () => {}, subscribe: () => () => {} }
  const Store: Context<PublishedStore<T>> = createContext(nowhere)
  return {
    Provider: ({ children }) => {
      const [store] = useState(() => createStore<T>(null))
      return createElement(Store.Provider, { value: store }, children)
    },
    Value: ({ value, children }) => {
      const [store] = useState(() => createStore<T>(value))
      useEffect(() => store.set(value), [store, value])
      return createElement(Store.Provider, { value: store }, children)
    },
    usePublish: (value) => {
      const store = useContext(Store)
      useEffect(() => {
        store.set(value)
      })
      useEffect(() => () => store.set(null), [store])
    },
    useValue: () => {
      const store = useContext(Store)
      return useSyncExternalStore(store.subscribe, store.get, store.get)
    },
  }
}
