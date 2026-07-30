import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type ToastKind = 'error' | 'info' | 'success'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

/**
 * The mounted provider's `push`, reachable from outside React.
 *
 * The QueryClient is built before any component renders, so its global
 * mutation-error handler cannot use the context hook — it needs a way in that
 * does not sit under the provider. A registered sink is that way in; before the
 * provider mounts (and after it unmounts) a push is simply dropped, which is
 * the right answer when there is no UI to show it in.
 */
let sink: ToastApi['push'] | null = null

/** Raise a toast from outside the React tree (the global mutation handler). */
export function pushToast(message: string, kind: ToastKind = 'error'): void {
  sink?.(message, kind)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'error') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  useEffect(() => {
    sink = push
    return () => {
      if (sink === push) sink = null
    }
  }, [push])

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast used outside ToastProvider')
  return ctx
}
