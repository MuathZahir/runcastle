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
 * A toast is the one floating surface in the app that is not a dialog, so it is
 * also the one that carries a shadow rather than a hairline: it has to read as
 * hovering over whatever it landed on. Clicking anywhere on it dismisses it,
 * which is why the whole card is the cursor target.
 */
const TOAST_BASE =
  'cursor-pointer animate-toast-in rounded-md border bg-panel px-3.5 py-2.5 text-sm break-words ' +
  'shadow-[0_12px_30px_-14px_rgba(0,0,0,0.8)]'

const TOAST_KIND: Record<ToastKind, string> = {
  error: 'border-danger/55 text-danger',
  success: 'border-ok/50 text-ok',
  info: 'border-hairline text-text-2',
}

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
      <div className="fixed right-4 bottom-8.5 z-[400] flex max-w-95 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${TOAST_BASE} ${TOAST_KIND[t.kind]}`}
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
