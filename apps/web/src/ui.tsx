import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type {
  FindingSeverity,
  Phase,
  RunStatus,
  SessionStatus,
  TestNoteAuthor,
  TicketKind,
  TicketStatus,
} from '@runcastle/core'
import type { CheckRow, CheckTone, LapGroup } from './lib/feature-ui'

/**
 * Primitive UI atoms for the IDE shell (apps/web/STYLE.md). Exactly one `solid`
 * button is visible per view — everything else is `ghost`. No cards, no shadows.
 *
 * Every primitive is styled with Tailwind utilities written inline on the theme
 * tokens (decision 5): a primitive's whole look lives in this file, which is the
 * file the flow features copy from. No `@apply`, no `clsx`/`cva`/`tailwind-merge`
 * — {@link cx} below is the whole of the variant machinery.
 *
 * Focus rings are deliberately absent from these class lists: `styles.css` sets
 * `:focus-visible { box-shadow: var(--ring) }` globally and unlayered, so it
 * already paints every one of them and would shadow a utility that repeated it.
 */

/** Join the parts that are present. Falsy branches drop out. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'solid' | 'ghost' | 'danger'

const BUTTON_BASE =
  'inline-flex h-(--control-h) items-center justify-center gap-1.5 whitespace-nowrap ' +
  'rounded-md border px-3 text-sm font-medium ' +
  'transition-[color,background-color,border-color,box-shadow,transform,opacity] ' +
  'duration-(--dur-1) ease-app enabled:active:scale-[0.99] ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

const BUTTON_VARIANT: Record<Variant, string> = {
  ghost:
    'border-hairline bg-transparent text-text enabled:hover:border-hairline-strong enabled:hover:bg-panel',
  solid:
    'border-accent bg-accent font-semibold text-accent-ink enabled:hover:border-accent-2 enabled:hover:bg-accent-2',
  danger: 'border-danger/55 text-danger enabled:hover:border-danger enabled:hover:bg-danger/12',
}

export function Button({
  variant = 'ghost',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...rest}>
      {children}
    </button>
  )
}

/**
 * 11px uppercase tracked section title.
 *
 * Keeps the `section-title` class as a hook: two surviving legacy rules place it
 * in their surface (`.body-title`, `.mr-head`) and raw spans elsewhere still
 * carry the class, so its rule stays in `styles.css` until those flows migrate.
 * The utilities below say the same thing the rule does — 11px is already the
 * theme's micro-label step — and are what is left when it goes.
 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="section-title py-1 text-xs font-semibold tracking-[0.09em] text-text-3 uppercase">
      {children}
    </div>
  )
}

/**
 * One dim mono line — inline empty/error state for tight spots.
 *
 * Keeps `dim-line mono` for the same reason {@link SectionTitle} keeps its
 * class: `.map-waypoints > .dim-line` turns this into the map rail's dashed
 * placeholder, and the error boundary renders the pair raw.
 */
export function DimLine({ children }: { children: ReactNode }) {
  return <div className="dim-line mono py-0.5 font-mono text-sm text-text-3">{children}</div>
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
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-1.5 text-center',
        compact ? 'px-5 py-6' : 'px-6 py-11',
      )}
    >
      {icon && (
        <div className="mb-1 flex size-9 items-center justify-center rounded-md border border-hairline bg-panel-3 text-text-3">
          {icon}
        </div>
      )}
      <div className="text-base font-medium text-text-2">{title}</div>
      {hint && <div className="max-w-[42ch] text-sm text-pretty text-text-3">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Review-figure tones (findings F23): absence is grey, never green. */
const CHECK_TONE: Record<CheckTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-text-3',
}

/**
 * One review figure — tone dot, label, value. Shared by the review SUMMARY card
 * and the merge confirmation that quotes it, so a figure cannot be green in the
 * card and amber in the dialog. The tone comes from the view-model; the dot only
 * paints it.
 */
export function CheckLine({ row }: { row: CheckRow }) {
  return (
    <div className="mt-3 flex items-center gap-2.5">
      <span className={cx('size-2 shrink-0 rounded-pill', CHECK_TONE[row.tone])} />
      <span className="w-23 shrink-0 font-mono text-sm text-text">{row.key}</span>
      <span className="font-mono text-xs text-text-3">{row.value}</span>
    </div>
  )
}

const LAP_HEAD =
  'lap-group-head flex items-baseline gap-2 py-2 font-mono text-xs tracking-[0.06em] uppercase'

/**
 * Rows under `Lap N` headers (decisions.md #6) — the shared shape of the ticket
 * ledger and the notes inbox, which are the two places a human looks for "what
 * was done this lap" and used to render everything flat.
 *
 * The current lap is a plain always-open section; earlier laps are a `<details>`
 * that opens on a click — the same collapse idiom the map rail uses for its done
 * waypoints. The caret is drawn here rather than left to the native marker: a
 * flex summary drops the marker entirely, and a collapsed lap with no affordance
 * reads as a lap with nothing in it. A feature still on LAP 1 gets no headers at
 * all: it never iterated, and a "Lap 1" band over everything it owns is exactly
 * the ceremony ADR-0010 §4 keeps off a feature that merges first try.
 *
 * That suppression keys on the feature's lap, never on how many laps have rows.
 * A lap-2 feature whose rows are all lap-1 carryovers has exactly one group, and
 * heading it is the whole point: the lap banner directly above already says LAP
 * 2, so a flat list there would have the two halves of the workspace disagreeing
 * about which lap the human is looking at.
 *
 * The `lap-group` / `lap-group-head` classes are hooks, not styling: inside the
 * bordered ledger a surviving legacy rule turns the header into a band that
 * lines up with the rows' gutter.
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
            <span>Lap {g.lap}</span>
            <span className="text-text-4">{meta(g)}</span>
          </>
        )
        return g.current ? (
          <section className="lap-group" key={g.lap}>
            <div className={cx(LAP_HEAD, 'text-text-2')}>{head}</div>
            {children(g.rows)}
          </section>
        ) : (
          <details className="lap-group group" key={g.lap}>
            <summary
              className={cx(
                LAP_HEAD,
                "cursor-pointer list-none text-text-3 before:shrink-0 before:text-text-4 before:content-['▸']",
                "group-open:before:content-['▾'] [&::-webkit-details-marker]:hidden",
              )}
            >
              {head}
            </summary>
            {children(g.rows)}
          </details>
        )
      })}
    </>
  )
}

const PHASE_FG: Record<Phase, string> = {
  ideation: 'text-ph-ideation',
  spec: 'text-ph-spec',
  tickets: 'text-ph-tickets',
  implementation: 'text-ph-implementation',
  review: 'text-ph-review',
  shipped: 'text-ph-shipped',
}

export function PhaseTag({ phase }: { phase: Phase }) {
  return (
    <span className={cx('font-mono text-sm font-semibold lowercase', PHASE_FG[phase])}>
      {phase}
    </span>
  )
}

const CHIP_BASE =
  'inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 font-mono text-xs'

/** A burning ticket and a running lane breathe on the app's own `pulse`. */
const CHIP_PULSE = 'animate-[pulse_1.5s_ease-in-out_infinite]'

/**
 * The two review-flavoured badges: a ticket that verifies the branch, and a note
 * the agent that verified it wrote. Both mark WHOSE work a row is, not a status
 * the human has to act on, so they share the review phase's colour, and neither
 * is ever squeezed by the title beside it.
 */
const CHIP_REVIEW = 'shrink-0 border-ph-review/40 bg-ph-review/8 text-ph-review'

const TICKET_STATUS_CHIP: Record<TicketStatus, string> = {
  pending: 'border-hairline text-text-3',
  burning: `border-ph-implementation/45 bg-ph-implementation/8 text-ph-implementation ${CHIP_PULSE}`,
  done: 'border-ok/40 text-ok',
  failed: 'border-danger/45 text-danger',
  cancelled: 'border-hairline text-text-3 line-through',
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <span className={cx(CHIP_BASE, TICKET_STATUS_CHIP[status])}>{status}</span>
}

/**
 * The kind badge, shown only for `review` tickets: implementation is the
 * default and the overwhelming majority, so badging it would be noise on every
 * row without distinguishing anything.
 */
export function TicketKindChip({ kind }: { kind: TicketKind }) {
  if (kind === 'implementation') return null
  return (
    <span className={cx(CHIP_BASE, CHIP_REVIEW)} title="Verifies the integrated feature branch">
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
    <span className={cx(CHIP_BASE, CHIP_REVIEW)} title="Written by the review agent">
      {author}
    </span>
  )
}

/**
 * How bad the review thought a finding was — read, never enforced (decisions
 * #8), so even `high` is amber: an open defect is information the human decides
 * about, and red would read as a merge this app is refusing.
 */
const SEVERITY_CHIP: Record<FindingSeverity, string> = {
  high: 'border-warn/45 text-warn',
  medium: 'border-hairline text-text-2',
  low: 'border-hairline text-text-3',
}

/**
 * How bad the review agent thought a finding was. Display and ordering only —
 * severity never gates anything (decisions #8), so every level gets a chip: a
 * list where only the loud rows are labelled reads as if the quiet ones were
 * unclassified.
 */
export function FindingSeverityChip({ severity }: { severity: FindingSeverity }) {
  return <span className={cx(CHIP_BASE, SEVERITY_CHIP[severity])}>{severity}</span>
}

const RUN_STATUS_CHIP: Record<RunStatus, string> = {
  running: `border-ph-implementation/45 text-ph-implementation ${CHIP_PULSE}`,
  succeeded: 'border-ok/40 text-ok',
  failed: 'border-danger/45 text-danger',
  cancelled: 'border-hairline text-text-3',
}

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <span className={cx(CHIP_BASE, RUN_STATUS_CHIP[status])}>{status}</span>
}

const SESSION_DOT: Record<SessionStatus, string> = {
  launching: 'bg-needs animate-[pulse_1.3s_ease-in-out_infinite]',
  live: 'bg-ok ring-3 ring-ok/15',
  ended: 'bg-text-3',
}

export function SessionStatusDot({ status }: { status: SessionStatus }) {
  return (
    <span
      className={cx('inline-block size-2 shrink-0 rounded-pill', SESSION_DOT[status])}
      title={status}
    />
  )
}
