import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ButtonHTMLAttributes, ReactNode, RefObject } from 'react'
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

type DialogSize = 'sm' | 'md' | 'lg'

const DIALOG_SIZE: Record<DialogSize, string> = {
  sm: 'max-w-[460px]',
  md: 'max-w-[620px]',
  lg: 'max-w-[780px]',
}

/**
 * The one modal shell. Every overlay in the app runs its mechanics through this
 * — portal, Escape, backdrop dismissal, focus — because those mechanics were
 * copy-pasted into five components and had already drifted apart between them
 * (one closed on `click`, the rest on `mousedown`; one asked before discarding,
 * the rest threw prose away; none restored focus).
 *
 * The three mechanics that look like details and are not:
 *
 * - **Escape only answers when the focus is ours.** The command palette and the
 *   settings pane can be open ON TOP of another dialog, and the topmost one owns
 *   the key. Focus is the only thing that says which that is, so a dialog that
 *   answered unconditionally would close underneath the one the user is looking
 *   at. `null`/`<body>` counts as ours — that is where a click on our own
 *   backdrop leaves it.
 * - **The backdrop dismisses on `mousedown`, not `click`.** A drag that starts
 *   inside the panel (selecting a slug, a summary, a field value) and releases
 *   outside it is a selection, not a dismissal.
 * - **Focus returns to the opener.** Otherwise closing a dialog drops the
 *   keyboard back at the top of the document.
 *
 * The panel keeps whatever `className` the caller passes and the backdrop
 * whatever `backdropClassName` it passes: the five existing overlays hand over
 * their own legacy class names and so keep their present look, which their own
 * flow feature redesigns later.
 */
export function Dialog({
  open,
  onClose,
  size = 'md',
  label,
  labelledBy,
  dirty = false,
  discardPrompt = 'Discard what you have typed?',
  initialFocusRef,
  returnFocusRef,
  inline = false,
  backdropClassName,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  size?: DialogSize
  /** Accessible name, when no visible element in the panel can supply one. */
  label?: string
  /** Id of the element that names the panel — takes precedence over `label`. */
  labelledBy?: string
  /** Something has been typed that dismissing would throw away. */
  dirty?: boolean
  /** The question asked before a dirty dialog is dismissed. */
  discardPrompt?: string
  /** Focused on open. Defaults to the panel, and never steals from `autoFocus`. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Stable focus target for a conditionally mounted dialog or transient opener. */
  returnFocusRef?: RefObject<HTMLElement | null>
  /**
   * Render in place instead of portalling, for a "dialog" that is really a
   * region: the feature-creation form fills the workspace column and leaves the
   * sidebar live behind it, so portalling it to `<body>` would blank the
   * workspace and cover navigation that is still meant to work. Such a dialog is
   * not `aria-modal` either — the content around it genuinely is reachable.
   */
  inline?: boolean
  backdropClassName?: string
  className?: string
  /** A function child receives the guarded `dismiss`, so a Cancel button in the
   *  content goes through the discard question rather than around it. */
  children: ReactNode | ((dismiss: () => void) => ReactNode)
}) {
  const [confirming, setConfirming] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = returnFocusRef?.current ?? document.activeElement
    const panel = panelRef.current
    // React has already honoured any `autoFocus` in the content by now, so only
    // take the focus when nothing inside the panel holds it.
    if (panel && !panel.contains(document.activeElement)) {
      ;(initialFocusRef?.current ?? panel).focus()
    }
    return () => {
      const target = opener instanceof HTMLElement && opener.isConnected ? opener : returnFocusRef?.current
      if (!target?.isConnected) return
      target.focus()
      // A backdrop mousedown can finish its native focus action after React has
      // synchronously unmounted the portal. Reassert the return focus once that
      // event has completed; this is especially relevant to conditionally
      // mounted peeks whose panel was the last focused element.
      queueMicrotask(() => {
        const focused = document.activeElement
        const fallback = target.isConnected ? target : returnFocusRef?.current
        if (fallback?.isConnected && (focused === null || focused === document.body)) fallback.focus()
      })
    }
    // Deliberately keyed on `open` alone: `initialFocusRef` is read once, at
    // open, and re-running this would re-grab the focus mid-dialog.
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const focused = document.activeElement
      const mine =
        focused === null || focused === document.body || !!panelRef.current?.contains(focused)
      if (!mine) return
      // Escape out of the question first — it is the smaller of the two things
      // open, and answering it with the same key that raised it would be a trap.
      if (confirming) setConfirming(false)
      else if (dirty) setConfirming(true)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirming, dirty, onClose])

  if (!open) return null

  const dismiss = () => {
    if (dirty) setConfirming(true)
    else onClose()
  }

  const tree = (
    <div
      className={cx(
        inline
          ? 'flex flex-1 items-center justify-center p-6'
          : 'fixed inset-0 z-[200] flex items-start justify-center bg-bg/70 px-4 pt-[8vh] pb-4',
        backdropClassName,
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          // Closing unmounts the dialog and restores the opener's focus. Cancel
          // this mousedown's later native focus step, or the browser moves focus
          // from that opener back to <body> after the restore has completed.
          e.preventDefault()
          dismiss()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          'w-full rounded-lg border border-hairline-strong bg-panel shadow-overlay',
          DIALOG_SIZE[size],
          className,
        )}
      >
        {typeof children === 'function' ? children(dismiss) : children}
        {confirming && (
          <div
            className="mt-4 flex items-center gap-2 rounded-sm border border-warn/45 bg-warn/8 px-3 py-2.5"
            role="alert"
          >
            <span className="flex-1 text-base text-text">{discardPrompt}</span>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={onClose}>
              Discard
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  return inline ? tree : createPortal(tree, document.body)
}

/**
 * A labelled control with its help and error text wired to it — the three ids
 * an assistive technology needs in order to read a field as one thing rather
 * than as three unrelated strings near each other.
 *
 * The control is the child: it is cloned with an `id` and `aria-describedby` so
 * the call site stays `<Field label="Base"><select …/></Field>`.
 * An `id` already on the control wins — something else is pointing at it — and
 * the label follows it there rather than dangling on the generated one.
 */
export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  /** Force the control's id, rather than generating one. */
  htmlFor?: string
  children: ReactNode
}) {
  const generated = useId()
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? children
    : null
  const id = control?.props.id ?? htmlFor ?? generated
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = cx(help ? helpId : null, error ? errorId : null) || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-2" htmlFor={id}>
        {label}
      </label>
      {control
        ? cloneElement(control, {
            id,
            'aria-describedby': cx(control.props['aria-describedby'], describedBy) || undefined,
          })
        : children}
      {help && (
        <div id={helpId} className="text-sm text-text-3">
          {help}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

/** A bounded surface for a group of related content, with an optional header. */
export function Card({
  header,
  className,
  children,
}: {
  header?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('rounded-lg border border-hairline bg-panel p-4', className)}>
      {header && (
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-hairline-soft pb-3">
          {header}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * A titled {@link Card} — the shape most of the app's panels are. Kept a
 * separate export rather than a `Card` title prop (the spec left the choice
 * open) so the title stays outside the card's border, which is where every
 * existing {@link SectionTitle} in the app sits.
 */
export function Section({
  title,
  className,
  children,
}: {
  title: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Card className={className}>{children}</Card>
    </section>
  )
}

/** One key in a keyboard hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-hairline bg-panel-3 px-1.5 font-mono text-xs text-text-2">
      {children}
    </kbd>
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
 * Even `high` is amber: an open defect is information the human decides about,
 * and red would read as a merge this app is refusing.
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
