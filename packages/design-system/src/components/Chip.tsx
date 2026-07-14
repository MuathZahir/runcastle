import type { ReactNode } from 'react'

export interface ChipProps {
  /** Status colour. `active` pairs naturally with `pulse`. */
  tone?: 'neutral' | 'pending' | 'active' | 'done' | 'failed' | 'blocked'
  /** Animate opacity to signal in-progress work (a burning ticket, a live run). */
  pulse?: boolean
  children?: ReactNode
}

/**
 * A rounded hairline pill for a short status token — ticket or run state, a
 * count, a label. Colour plus an optional `pulse` carry the meaning; the shape
 * stays constant.
 */
export function Chip({ tone = 'neutral', pulse, children }: ChipProps) {
  const cls = ['chip', `chip-${tone}`, pulse ? 'is-pulsing' : ''].filter(Boolean).join(' ')
  return <span className={cls}>{children}</span>
}
