import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { IconAlert, IconCheck, IconInfo } from '../icons'

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
 * A toast floats like a menu: `surface-raised`, `rounded-lg`, `shadow-popover`,
 * sliding up into the bottom-right corner (DESIGN.md §Motion). The message is
 * in `text`; the kind is told by a leading glyph in its tone, not by a tinted
 * card. Clicking anywhere on it dismisses it, which is why the whole card is
 * the cursor target.
 */
const TOAST_BASE =
  'flex cursor-pointer items-start gap-2.5 animate-toast-in rounded-lg bg-surface-raised px-3 py-2.5 ' +
  'text-sm break-words text-text shadow-popover'

const TOAST_GLYPH: Record<ToastKind, ReactNode> = {
  error: <IconAlert size={16} className="mt-0.5 shrink-0 text-danger" />,
  success: <IconCheck size={16} className="mt-0.5 shrink-0 text-success" />,
  info: <IconInfo size={16} className="mt-0.5 shrink-0 text-icon" />,
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
      <div
        className="fixed right-4 bottom-4 z-[400] flex max-w-95 flex-col items-end gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-kind={t.kind}
            className={TOAST_BASE}
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
          >
            {TOAST_GLYPH[t.kind]}
            <span className="min-w-0">{t.message}</span>
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
