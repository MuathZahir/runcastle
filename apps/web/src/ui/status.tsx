import type { ReactNode } from 'react'
import type {
  FindingSeverity,
  Phase,
  RunStatus,
  SessionStatus,
  TestNoteAuthor,
  TicketKind,
  TicketStatus,
} from '@runcastle/core'
import type { CheckRow, CheckTone } from '../lib/feature-ui'
import {
  IconAlert,
  IconCheck,
  IconShield,
  IconSparkle,
  PHASE_NAME,
  PhaseIcon,
} from '../icons'
import type { PhaseIconPhase } from '../icons'
import { Spinner } from './button'
import { cx } from './floating'

/**
 * Status, said as a glyph and a word (DESIGN.md: "Facts are text, not boxes";
 * "Shape before hue"). Every former chip is a {@link StatusLabel} now: no pill,
 * no outline, no tinted ground — a dot or 16px glyph in the tone's colour and a
 * sentence-case word in `text-secondary`.
 */

/** The six tones a dot or status glyph can take. `live` is `accent` and breathes. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'accent' | 'live' | 'neutral'

const DOT_TONE: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
  live: 'bg-accent animate-breathe shadow-[0_0_0_3px_var(--color-accent-subtle)]',
  neutral: 'bg-icon',
}

/** A tone's text colour, for a glyph that should wear it. */
export const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  accent: 'text-accent',
  live: 'text-accent',
  neutral: 'text-icon',
}

/**
 * A 6px dot for a state — running, healthy, needs you. Pass `label` when
 * nothing beside it says the state in words (it becomes `role="img"` with that
 * name); otherwise it is decorative. `live` breathes (2s).
 */
export function StatusDot({
  tone = 'neutral',
  label,
  className,
}: {
  tone?: StatusTone
  label?: string
  className?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cx('inline-block size-1.5 shrink-0 rounded-full', DOT_TONE[tone], className)}
    />
  )
}

const LABEL_SIZE = {
  xs: { text: 'text-xs', box: 'size-3.5 [&>svg]:size-3.5' },
  sm: { text: 'text-sm', box: 'size-4 [&>svg]:size-4' },
} as const

/**
 * A dot or glyph plus a word — what every former chip becomes.
 *
 * - `tone` — draws a {@link StatusDot} in that tone (the default leading mark).
 * - `icon` — draws that glyph instead, coloured by `tone` (neutral → `icon`).
 * - `phase` — draws a {@link PhaseIcon} instead.
 * - `spinning` — draws a quiet {@link Spinner} instead (the word says the state).
 * - `size` — `xs` 12px (rows, meta; default) · `sm` 13px (property values).
 * - `strong` — the word in `text` rather than `text-secondary`.
 *
 * The leading mark sits in a fixed square, so dots and glyphs line up down a
 * column.
 */
export function StatusLabel({
  tone = 'neutral',
  icon,
  phase,
  spinning = false,
  size = 'xs',
  strong = false,
  title,
  className,
  children,
}: {
  tone?: StatusTone
  icon?: ReactNode
  phase?: PhaseIconPhase
  spinning?: boolean
  size?: 'xs' | 'sm'
  strong?: boolean
  title?: string
  className?: string
  children: ReactNode
}) {
  const s = LABEL_SIZE[size]
  const mark = spinning ? (
    <Spinner size="sm" />
  ) : phase ? (
    <PhaseIcon phase={phase} size={size === 'xs' ? 14 : 16} label="" />
  ) : icon ? (
    <span className={cx('inline-flex', TONE_TEXT[tone])}>{icon}</span>
  ) : (
    <StatusDot tone={tone} />
  )
  return (
    <span
      title={title}
      className={cx(
        'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap',
        s.text,
        strong ? 'font-medium text-text' : 'text-text-secondary',
        className,
      )}
    >
      <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center', s.box)}>
        {mark}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/* ---- the domain chips, now status labels (props unchanged) ---- */

/**
 * A feature's phase: its {@link PhaseIcon} and its sentence-case name. Accepts
 * the app's `Phase` and the finer design-system steps (and `draft`).
 */
export function PhaseTag({
  phase,
  size = 'sm',
  className,
}: {
  phase: Phase | PhaseIconPhase
  size?: 'xs' | 'sm'
  className?: string
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-text-secondary', LABEL_SIZE[size].text, className)}>
      <PhaseIcon phase={phase} size={size === 'xs' ? 14 : 16} label="" />
      {PHASE_NAME[phase]}
    </span>
  )
}

/**
 * A feature's phase where a row has no room to name it: the phase glyph alone
 * at 14px (labelled for screen readers). Shape, not a coloured dot.
 */
export function PhaseDot({ phase, className }: { phase: Phase | PhaseIconPhase; className?: string }) {
  return <PhaseIcon phase={phase} size={14} className={className} />
}

/** A ticket's status. `burning` spins; `cancelled` is struck through. */
export function TicketStatusChip({ status }: { status: TicketStatus }) {
  switch (status) {
    case 'pending':
      return <StatusLabel tone="neutral">Pending</StatusLabel>
    case 'burning':
      return <StatusLabel spinning>Burning</StatusLabel>
    case 'done':
      return (
        <StatusLabel tone="success" icon={<IconCheck />}>
          Done
        </StatusLabel>
      )
    case 'failed':
      return <StatusLabel tone="danger">Failed</StatusLabel>
    case 'cancelled':
      return (
        <StatusLabel tone="neutral" className="text-text-tertiary line-through">
          Cancelled
        </StatusLabel>
      )
  }
}

/**
 * Marks a `review` ticket; renders **nothing** for `implementation` — the
 * default would be noise on every row. A `verification` pass says so instead
 * (it confirms the fixes that landed rather than auditing the branch).
 */
export function TicketKindChip({
  kind,
  passKind,
}: {
  kind: TicketKind
  passKind?: 'review' | 'verification'
}) {
  if (kind === 'implementation') return null
  const verification = passKind === 'verification'
  return (
    <StatusLabel
      tone="accent"
      icon={<IconShield />}
      className="shrink-0"
      title={
        verification
          ? 'Confirms the fixes that landed since the last review'
          : 'Verifies the integrated feature branch'
      }
    >
      {verification ? 'Verification' : 'Review'}
    </StatusLabel>
  )
}

/** Marks the review agent's note; renders **nothing** for `human`. */
export function NoteAuthorChip({ author }: { author: TestNoteAuthor }) {
  if (author === 'human') return null
  return (
    <StatusLabel tone="accent" icon={<IconSparkle />} className="shrink-0" title="Written by the review agent">
      Agent
    </StatusLabel>
  )
}

/**
 * How bad the review thought a finding was. Display only — severity never
 * gates anything. Even `high` is `warning`, never `danger`: it is read, not
 * enforced.
 */
export function FindingSeverityChip({ severity }: { severity: FindingSeverity }) {
  switch (severity) {
    case 'high':
      return (
        <StatusLabel tone="warning" icon={<IconAlert />}>
          High
        </StatusLabel>
      )
    case 'medium':
      return <StatusLabel tone="neutral">Medium</StatusLabel>
    case 'low':
      return (
        <StatusLabel tone="neutral" className="text-text-tertiary">
          Low
        </StatusLabel>
      )
  }
}

/** A burn run's status. `running` spins. */
export function RunStatusChip({ status }: { status: RunStatus }) {
  switch (status) {
    case 'running':
      return <StatusLabel spinning>Running</StatusLabel>
    case 'succeeded':
      return (
        <StatusLabel tone="success" icon={<IconCheck />}>
          Succeeded
        </StatusLabel>
      )
    case 'failed':
      return <StatusLabel tone="danger">Failed</StatusLabel>
    case 'cancelled':
      return (
        <StatusLabel tone="neutral" className="text-text-tertiary">
          Cancelled
        </StatusLabel>
      )
  }
}

const SESSION_TONE: Record<SessionStatus, StatusTone> = {
  launching: 'warning',
  live: 'live',
  ended: 'neutral',
}

const SESSION_WORD: Record<SessionStatus, string> = {
  launching: 'Starting',
  live: 'Live',
  ended: 'Ended',
}

/** A session's lifecycle as a 6px dot: starting (warning, breathing) · live (accent, breathing) · ended. */
export function SessionStatusDot({ status }: { status: SessionStatus }) {
  // A `title`, not an accessible name: the dot usually sits inside a button
  // whose name is the conversation's title, and must not prefix it.
  return (
    <span
      title={SESSION_WORD[status]}
      className={cx(
        'inline-block size-1.5 shrink-0 rounded-full',
        DOT_TONE[SESSION_TONE[status]],
        status === 'launching' && 'animate-breathe',
      )}
    />
  )
}

/** Review-figure tones: absence is neutral, never green. */
const CHECK_TONE: Record<CheckTone, StatusTone> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  idle: 'neutral',
}

/**
 * One review figure — tone dot, key, value — as one row of a property list.
 * Shared by the review summary and the merge confirmation that quotes it, so a
 * figure cannot be green in one and amber in the other.
 */
export function CheckLine({ row }: { row: CheckRow }) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-text-tertiary first-letter:uppercase">{row.key}</span>
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <StatusDot tone={CHECK_TONE[row.tone]} />
      </span>
      <span className="min-w-0 truncate text-text">{row.value}</span>
    </div>
  )
}
