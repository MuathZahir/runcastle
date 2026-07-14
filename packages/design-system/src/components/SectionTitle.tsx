import type { ReactNode } from 'react'

export interface SectionTitleProps {
  children?: ReactNode
}

/**
 * An 11px uppercase, letter-spaced label that heads a group of controls or a
 * sidebar pane. The system's one heading style below the app title.
 */
export function SectionTitle({ children }: SectionTitleProps) {
  return <div className="section-title">{children}</div>
}
