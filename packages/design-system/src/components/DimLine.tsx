import type { ReactNode } from 'react'

export interface DimLineProps {
  children?: ReactNode
}

/**
 * One dim mono line — the system's single style for empty states, placeholders,
 * and quiet metadata ("no feature selected", a commit hash, a file path).
 */
export function DimLine({ children }: DimLineProps) {
  return <div className="dim-line">{children}</div>
}
