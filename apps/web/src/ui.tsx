import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Phase, RunStatus, SessionStatus, TicketStatus } from '@runcastle/core'

/**
 * Primitive UI atoms for the IDE shell (UI-SPEC §4). Exactly one `solid` button
 * is visible per view — everything else is `ghost`. No cards, no shadows.
 */

type Variant = 'solid' | 'ghost' | 'danger'

export function Button({
  variant = 'ghost',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={`btn btn-${variant}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  )
}

/** 11px uppercase tracked section title (UI-SPEC §4). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="section-title">{children}</div>
}

/** One dim mono line — the only empty/error state style (UI-SPEC §4/§5). */
export function DimLine({ children }: { children: ReactNode }) {
  return <div className="dim-line mono">{children}</div>
}

export function PhaseTag({ phase }: { phase: Phase }) {
  return <span className={`tag phase-fg-${phase}`}>{phase}</span>
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <span className={`chip chip-ticket-${status}`}>{status}</span>
}

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <span className={`chip chip-run-${status}`}>{status}</span>
}

export function SessionStatusDot({ status }: { status: SessionStatus }) {
  return <span className={`status-dot sess-dot-${status}`} title={status} />
}
