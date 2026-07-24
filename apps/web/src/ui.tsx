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

/** One dim mono line — inline empty/error state for tight spots (UI-SPEC §4/§5). */
export function DimLine({ children }: { children: ReactNode }) {
  return <div className="dim-line mono">{children}</div>
}

/**
 * Designed empty state: quiet icon chip, plain-language title, one-line hint,
 * optional action. Replaces the dashed placeholder boxes so blank areas read
 * as intentional, not unfinished.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact,
}: {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty-state${compact ? ' is-compact' : ''}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
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
