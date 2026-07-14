import type { ReactNode } from 'react'

export interface ToastProps {
  /** Colour of the hairline and text accent. */
  tone?: 'info' | 'error' | 'success'
  children?: ReactNode
}

/**
 * A transient bordered notification. `error` and `success` tint the hairline
 * and text; `info` stays quiet. Stack these bottom-right in your app; the
 * component renders one toast.
 */
export function Toast({ tone = 'info', children }: ToastProps) {
  return <div className={`toast toast-${tone}`}>{children}</div>
}
