import type { ReactNode } from 'react'

export interface TagProps {
  /**
   * Feature-lifecycle phase; sets the colour from the phase palette. Omit for
   * neutral secondary text.
   */
  tone?: 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'
  children?: ReactNode
}

/**
 * A lowercase mono identifier tag coloured by lifecycle phase. The phase
 * palette (violet → grey → amber → orange → blue → green) is the system's
 * semantic colour spine — reuse these tones wherever phase is expressed.
 */
export function Tag({ tone, children }: TagProps) {
  return <span className={['tag', tone ? `tag-${tone}` : ''].filter(Boolean).join(' ')}>{children}</span>
}
