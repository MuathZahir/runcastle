import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type {
  Phase,
  RunStatus,
  SessionStatus,
  TestNoteAuthor,
  TicketKind,
  TicketStatus,
} from '@runcastle/core'
import type { CheckRow, LapGroup } from './lib/feature-ui'

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

/**
 * Rows under `Lap N` headers (decisions.md #6) — the shared shape of the ticket
 * ledger and the notes inbox, which are the two places a human looks for "what
 * was done this lap" and used to render everything flat.
 *
 * The current lap is a plain always-open section; earlier laps are a `<details>`
 * that opens on a click — the same collapse idiom the map rail uses for its done
 * waypoints. A feature still on LAP 1 gets no headers at all: it never iterated,
 * and a "Lap 1" band over everything it owns is exactly the ceremony ADR-0010 §4
 * keeps off a feature that merges first try.
 *
 * That suppression keys on the feature's lap, never on how many laps have rows.
 * A lap-2 feature whose rows are all lap-1 carryovers has exactly one group, and
 * heading it is the whole point: the lap banner directly above already says LAP
 * 2, so a flat list there would have the two halves of the workspace disagreeing
 * about which lap the human is looking at.
 */
export function LapSections<T extends { lap: number }>({
  groups,
  currentLap,
  meta,
  children,
}: {
  groups: LapGroup<T>[]
  /** The feature's own lap — what decides whether headers show at all. */
  currentLap: number
  /** One line about what a lap holds, shown beside its number. */
  meta: (group: LapGroup<T>) => string
  children: (rows: T[]) => ReactNode
}) {
  if (currentLap <= 1) return <>{children(groups.flatMap((g) => g.rows))}</>

  return (
    <>
      {groups.map((g) => {
        const head = (
          <>
            <span className="lap-group-n">Lap {g.lap}</span>
            <span className="lap-group-meta">{meta(g)}</span>
          </>
        )
        return g.current ? (
          <section className="lap-group is-current" key={g.lap}>
            <div className="lap-group-head">{head}</div>
            {children(g.rows)}
          </section>
        ) : (
          <details className="lap-group" key={g.lap}>
            <summary className="lap-group-head">{head}</summary>
            {children(g.rows)}
          </details>
        )
      })}
    </>
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
