import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type {
  Phase,
  RunStatus,
  SessionStatus,
  TestNoteAuthor,
  TicketKind,
  TicketStatus,
} from '@runcastle/core'
import type { CheckRow } from './lib/feature-ui'

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

/**
 * One review figure — tone dot, label, value. Shared by the review SUMMARY card
 * and the merge confirmation that quotes it, so a figure cannot be green in the
 * card and amber in the dialog. The tone comes from the view-model; the dot only
 * paints it.
 */
export function CheckLine({ row }: { row: CheckRow }) {
  return (
    <div className="check-row">
      <span className={`check-dot is-${row.tone}`} />
      <span className="check-k">{row.key}</span>
      <span className="check-v">{row.value}</span>
    </div>
  )
}

export function PhaseTag({ phase }: { phase: Phase }) {
  return <span className={`tag phase-fg-${phase}`}>{phase}</span>
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <span className={`chip chip-ticket-${status}`}>{status}</span>
}

/**
 * The kind badge, shown only for `review` tickets: implementation is the
 * default and the overwhelming majority, so badging it would be noise on every
 * row without distinguishing anything.
 */
export function TicketKindChip({ kind }: { kind: TicketKind }) {
  if (kind === 'implementation') return null
  return (
    <span className="chip chip-kind-review" title="Verifies the integrated feature branch">
      {kind}
    </span>
  )
}

/**
 * Who wrote a test note, shown only for the review agent's — same reasoning as
 * {@link TicketKindChip}: the human is the default author and badging every one
 * of their own notes would distinguish nothing. This is the whole of the
 * attribution the review panel needs (decisions #7): the human has to be able to
 * tell the agent's findings from their own at a glance, and nothing more.
 */
export function NoteAuthorChip({ author }: { author: TestNoteAuthor }) {
  if (author === 'human') return null
  return (
    <span className="chip chip-note-agent" title="Written by the review agent">
      {author}
    </span>
  )
}

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <span className={`chip chip-run-${status}`}>{status}</span>
}

export function SessionStatusDot({ status }: { status: SessionStatus }) {
  return <span className={`status-dot sess-dot-${status}`} title={status} />
}
