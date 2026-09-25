import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { LapGroup } from './lib/feature-ui'
import { IconChevronDown, IconChevronRight, IconX } from './icons'
import { Button, IconButton } from './ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import { cx } from './ui/floating'
import { SectionLabel } from './ui/list'

/**
 * The shared primitives (apps/web/DESIGN.md §Components, STYLE.md §Primitives).
 * Import every primitive from here — this file re-exports the ones that live
 * in `src/ui/` — and never hand-roll a button, row, chip, menu, dialog, tab set
 * or empty state in a surface.
 *
 * Every primitive is styled with Tailwind utilities on the design-system tokens
 * (`bg-surface`, `text-text-secondary`, `border-border-subtle` …); a
 * primitive's whole look lives in its own file. No `@apply`, no
 * `clsx`/`cva`/`tailwind-merge` — {@link cx} is the whole variant machinery.
 *
 * Focus rings are deliberately absent from these class lists: `styles.css`
 * draws the `:focus-visible` outline globally and unlayered.
 */

export { cx } from './ui/floating'
export { Kbd } from './ui/kbd'
export { Tooltip, TooltipProvider } from './ui/tooltip'
export { BARE_BUTTON, Button, IconButton, LINK, Spinner } from './ui/button'
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './ui/button'
export {
  CheckLine,
  FindingSeverityChip,
  NoteAuthorChip,
  PhaseDot,
  PhaseTag,
  RunStatusChip,
  SessionStatusDot,
  StatusDot,
  StatusLabel,
  TicketKindChip,
  TicketStatusChip,
  TONE_TEXT,
} from './ui/status'
export type { StatusTone } from './ui/status'
export { List, ListRow, MetaLine, NavItem, PropertyList, SectionLabel } from './ui/list'
export type { MetaItem, PropertyItem } from './ui/list'
export { Tabs } from './ui/tabs'
export type { TabItem } from './ui/tabs'
export { Field, SearchField, TEXT_INPUT, TextArea, TextField } from './ui/field'
export type { TextFieldProps } from './ui/field'
export { Aside, AsideLayout, Crumbs, Page, PageHeader, PageSection, PageTopbar } from './ui/page'
export { Checkbox, SegmentedControl, Switch } from './ui/choice'
export type { SegmentItem } from './ui/choice'
export type { Crumb } from './ui/page'

/**
 * The old section heading. Renders exactly as {@link SectionLabel} now (12px
 * medium, sentence case, `text-tertiary`) — the uppercase tracked label is
 * retired. New code uses `SectionLabel`.
 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <SectionLabel>{children}</SectionLabel>
}

/** One quiet line — an inline empty or error state for a tight spot, in `text-xs text-tertiary`. */
export function DimLine({ children }: { children: ReactNode }) {
  return <div className="py-0.5 text-xs text-text-tertiary">{children}</div>
}

/**
 * A calm blank area (DESIGN.md: empty areas are an EmptyState, never a box):
 * a `text-tertiary` icon (20px), a short `title`, one `hint` line, at most one
 * `action` (a Button). No frame, no icon chip. `compact` for tight spots.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-1.5 text-center',
        compact ? 'px-6 py-8' : 'px-6 py-12',
        className,
      )}
    >
      {icon && <div className="mb-1.5 inline-flex text-text-tertiary [&>svg]:size-5">{icon}</div>}
      <div className="text-base leading-5 font-medium text-text">{title}</div>
      {hint && <div className="max-w-80 text-sm text-pretty text-text-tertiary">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

const DISCLOSURE_SUMMARY = {
  md: 'h-10 items-center gap-2 text-sm font-medium text-text-secondary hover:text-text',
  sm: 'min-h-6 items-start gap-1.5 py-1 text-xs text-text-tertiary hover:text-text-secondary',
} as const

const DISCLOSURE_BODY = {
  md: 'pb-4 pl-6 text-sm text-text-secondary',
  sm: 'pt-0.5 pb-2 pl-4.5 text-xs text-text-secondary',
} as const

/**
 * A collapsed section (DESIGN.md principle 6: collapse what is read once) —
 * drive instructions, digests, raw logs. A `<details>`: chevron (rotates 90°),
 * optional `icon`, `title`, and an `aside` on the right (a count, a
 * timestamp, a link); the body opens with an animated height. Closed by
 * default (`defaultOpen` to start open).
 *
 * `size`:
 * - `md` (default) — a 40px medium row for a page section; a `border-subtle`
 *   rule above it separates stacked disclosures (`bare` drops it).
 * - `sm` — a compact 12px text-level line (and a 12px body) under something else: a tool call
 *   in a transcript, "What the engine reported", a defect's detail. No rule;
 *   the title **wraps** rather than truncating (put `truncate` inside it when
 *   one line is wanted).
 *
 * `index` staggers its entrance like a `ListRow` (the first 8 of an initial
 * render rise in 20ms apart); `animate` rises it in alone.
 */
export function Disclosure({
  title,
  icon,
  aside,
  defaultOpen = false,
  bare = false,
  size = 'md',
  index,
  animate = false,
  onToggle,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode
  icon?: ReactNode
  aside?: ReactNode
  defaultOpen?: boolean
  bare?: boolean
  size?: 'sm' | 'md'
  /** Position on the initial render, for the entrance stagger. */
  index?: number
  /** Rise in on mount (without a stagger). */
  animate?: boolean
  onToggle?: (open: boolean) => void
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  // Uncontrolled: `open` is only the initial state. React leaves the attribute
  // alone while the prop does not change, so the user's toggles stand.
  const [initial] = useState(defaultOpen)
  const staggered = index !== undefined && index < 8
  return (
    <details
      data-disclosure=""
      open={initial}
      onToggle={onToggle && ((e) => onToggle((e.currentTarget as HTMLDetailsElement).open))}
      style={staggered ? ({ '--i': index } as CSSProperties) : undefined}
      className={cx(
        'group/disclosure min-w-0',
        size === 'md' && !bare && 'border-t border-border-subtle',
        (staggered || animate) && 'animate-rise-in',
        staggered && '[animation-delay:calc(var(--i)*20ms)]',
        className,
      )}
    >
      <summary
        className={cx(
          'flex cursor-pointer list-none rounded-md',
          'transition-colors duration-(--dur-1) ease-app select-none [&::-webkit-details-marker]:hidden',
          DISCLOSURE_SUMMARY[size],
        )}
      >
        <IconChevronRight
          size={size === 'sm' ? 12 : 14}
          className={cx(
            'shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-open/disclosure:rotate-90',
            size === 'sm' && 'mt-0.5',
          )}
        />
        {icon && <span className="inline-flex shrink-0 text-icon [&>svg]:size-3.5">{icon}</span>}
        <span className={cx('min-w-0 flex-1', size === 'md' && 'truncate')}>{title}</span>
        {aside && <span className="shrink-0 text-xs font-normal text-text-tertiary">{aside}</span>}
      </summary>
      <div className={cx(DISCLOSURE_BODY[size], bodyClassName)}>{children}</div>
    </details>
  )
}

/**
 * An inline failure about a path: the problem stated once, the path it is about
 * shown once beneath it, and what to do next — on the `danger-subtle` ground
 * (the one tinted ground an inline notice may take).
 *
 * The path gets its own line because a long one has to be truncated from the
 * *left* — the interesting end of a path is its tail. `dir="rtl"` moves the
 * ellipsis to the left; `<bdi>` isolates the path from bidi reordering.
 */
export function FailureNote({
  message,
  path,
  hint,
  action,
  id,
}: {
  message: string
  path?: string | null
  hint?: string | null
  /** The one thing that fixes this failure, when runcastle can run it itself. */
  action?: ReactNode
  id?: string
}) {
  return (
    <div className="rounded-md bg-danger-subtle px-3 py-2.5" id={id} role="alert">
      <div className="text-sm font-medium text-danger">{message}</div>
      {path && (
        <div className="mt-1 truncate text-left font-mono text-xs text-text-tertiary" dir="rtl" title={path}>
          <bdi>{path}</bdi>
        </div>
      )}
      {hint && <p className="mt-1.5 mb-0 text-sm text-text-secondary">{hint}</p>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  )
}

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'palette'

const DIALOG_SIZE: Record<DialogSize, string> = {
  sm: 'max-w-[460px]',
  md: 'max-w-[620px]',
  lg: 'max-w-[780px]',
  // Settings: a page rail beside a five-column model roster. `lg` clipped it.
  xl: 'max-w-[940px]',
  // Note capture: the palette's width, so it reads as the same gesture.
  palette: 'max-w-[560px]',
}

type DialogScrim = 'dim' | 'light' | 'none'

/**
 * How much of the page the backdrop hides. A lookup rather than a
 * `backdropClassName` override: two background utilities on one element are a
 * coin flip without `tailwind-merge`.
 */
const DIALOG_SCRIM: Record<DialogScrim, string> = {
  dim: 'bg-scrim animate-backdrop-in',
  // Note capture: you are noting something on the page, so it stays readable.
  light: 'bg-scrim/40 animate-backdrop-in',
  // Nothing left to dim — clicks fall through to the page (the panel opts back in).
  none: 'pointer-events-none bg-transparent',
}

/**
 * The one modal shell: `surface-raised`, `rounded-lg`, `shadow-dialog`; the
 * backdrop fades in and the panel rises (`animate-dialog-in`). Compose its
 * content with {@link DialogHeader}, {@link DialogBody} and
 * {@link DialogFooter}.
 *
 * Every overlay in the app runs its mechanics through this — portal, Escape,
 * backdrop dismissal, focus — because those mechanics were copy-pasted into
 * five components and had drifted apart.
 *
 * The three mechanics that look like details and are not:
 *
 * - **Escape only answers when the focus is ours.** The command palette and the
 *   settings pane can be open ON TOP of another dialog, and the topmost one owns
 *   the key. `null`/`<body>` counts as ours — that is where a click on our own
 *   backdrop leaves it.
 * - **The backdrop dismisses on `mousedown`, not `click`.** A drag that starts
 *   inside the panel and releases outside it is a selection, not a dismissal.
 * - **Focus returns to the opener** — if it was still ours at close.
 *
 * `className` lands on the panel and `backdropClassName` on the backdrop.
 */
export function Dialog({
  open,
  onClose,
  size = 'md',
  scrim = 'dim',
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
  /** How much the backdrop dims the page behind the panel. */
  scrim?: DialogScrim
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
   * region (the feature-creation form fills the workspace column and leaves the
   * sidebar live). Such a dialog is not `aria-modal` either.
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
      // Only hand the focus back if it was still ours when we closed. With the
      // scrim lifted the human can click into the page, and a close that fires
      // after that (a timer, say) must not drag the caret back mid-word.
      const focused = document.activeElement
      const stillOurs =
        focused === null || focused === document.body || !focused.isConnected || !!panel?.contains(focused)
      if (!stillOurs) return
      const target = opener instanceof HTMLElement && opener.isConnected ? opener : returnFocusRef?.current
      if (!target?.isConnected) return
      target.focus()
      // A backdrop mousedown can finish its native focus action after React has
      // synchronously unmounted the portal. Reassert the return focus once that
      // event has completed.
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
          : cx(
              'fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4',
              // The palette sits at 12vh; every other dialog at 8vh.
              size === 'palette' ? 'pt-[12vh]' : 'pt-[8vh]',
              DIALOG_SCRIM[scrim],
            ),
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
          'w-full rounded-lg bg-surface-raised text-sm text-text shadow-dialog animate-dialog-in',
          scrim === 'none' && 'pointer-events-auto',
          DIALOG_SIZE[size],
          className,
        )}
      >
        {typeof children === 'function' ? children(dismiss) : children}
        {confirming && (
          <div
            className="m-4 flex items-center gap-2 rounded-md bg-surface-hover px-3 py-2 animate-fade-in"
            role="alert"
          >
            <span className="flex-1 text-sm text-text">{discardPrompt}</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button variant="danger" size="sm" onClick={onClose}>
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
 * A dialog's header: the `title` (16/24 semibold; give it `id` and pass that as
 * the Dialog's `labelledBy`), an optional `description` in `text-secondary`,
 * and a close IconButton when `onClose` is given (pass the guarded `dismiss`).
 */
export function DialogHeader({
  title,
  description,
  onClose,
  id,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  onClose?: () => void
  id?: string
  className?: string
}) {
  return (
    <div className={cx('flex items-start gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="m-0 text-lg font-semibold text-text">
          {title}
        </h2>
        {description && <p className="mt-1 mb-0 text-sm text-text-secondary">{description}</p>}
      </div>
      {onClose && <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} className="-mr-1" />}
    </div>
  )
}

/** A dialog's content area, padded to line up with the header and footer. */
export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 pb-4', className)}>{children}</div>
}

/**
 * A dialog's footer: actions right-aligned (one primary, last), with an
 * optional `start` slot on the left (a secondary link, a note).
 */
export function DialogFooter({
  start,
  className,
  children,
}: {
  start?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('flex items-center gap-2 px-5 pt-1 pb-4', className)}>
      {start && <div className="mr-auto flex min-w-0 items-center gap-2 text-xs text-text-tertiary">{start}</div>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * A quiet bounded surface — `surface`, a `border` hairline, `rounded-lg`,
 * `p-4` — with an optional `header` slot. **Prefer no card**: page sections are
 * separated by air (`PageSection`), and facts are a `PropertyList`. Reach for a
 * card only for a genuinely separate object sitting inside a page.
 */
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
    <div className={cx('rounded-lg border border-border bg-surface p-4', className)}>
      {header && (
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
          {header}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * A labelled group: a {@link SectionLabel} over its content, with no card
 * border. `className` lands on the content. (For a page body's sections with a
 * 16px title, use `PageSection`.)
 */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section>
      <SectionLabel action={action}>{title}</SectionLabel>
      <div className={className}>{children}</div>
    </section>
  )
}

/**
 * Branches this app made for itself, and never somewhere a human means to land:
 * `runcastle/*`, `worktree-*` and `afk/*`. Filtered inside the primitive so no
 * caller has to remember the list.
 */
const NOISE_BRANCH = /^(?:runcastle\/|worktree-|afk\/)/

const BRANCH_TRIGGER =
  'inline-flex h-(--control-h) min-w-0 items-center gap-1.5 rounded-md border px-2 text-sm ' +
  'transition-colors duration-(--dur-1) ease-app ' +
  'disabled:cursor-not-allowed disabled:text-text-disabled'

/**
 * The inline branch picker: `landing on main ▾`, `from main ▾` — a branch
 * choice beside the button it is an argument to. `branches` undefined means
 * the list is in flight (the trigger is disabled). `missing` — a pick this repo
 * no longer has — paints the trigger `warning` and is the caller's cue to
 * disable whatever the branch is an argument to. The list is a searchable
 * `Combobox`.
 */
export function BranchMenu({
  prefix,
  value,
  branches,
  detected,
  onPick,
  missing = false,
  disabled = false,
  className,
}: {
  /** The words before the branch: `landing on`, `from`. */
  prefix: string
  /** The branch on the trigger, or null while nothing is chosen. */
  value: string | null
  /** Every local branch, or undefined while the list is in flight. */
  branches: string[] | undefined
  /** The repo's main line, headed off on its own in the menu when offered. */
  detected?: string
  onPick: (branch: string) => void
  /** The pick is gone, or there is no usable branch — the one error state. */
  missing?: boolean
  disabled?: boolean
  className?: string
}) {
  const offered = (branches ?? []).filter((b) => !NOISE_BRANCH.test(b))
  const main = detected && offered.includes(detected) ? detected : null
  const others = offered.filter((b) => b !== main)

  const row = (branch: string) => (
    <ComboboxItem
      key={branch}
      value={branch}
      current={branch === value}
      // The row's own branch, not the value cmdk hands back.
      onSelect={() => onPick(branch)}
    >
      {branch}
    </ComboboxItem>
  )

  return (
    <Combobox>
      {/* No `aria-label`: the trigger's own words — "landing on main" — are
          a better name than anything added here. */}
      <ComboboxTrigger
        disabled={disabled || !branches}
        className={cx(
          BRANCH_TRIGGER,
          missing
            ? 'border-transparent text-warning'
            : 'border-transparent text-text-secondary enabled:hover:bg-surface-hover enabled:hover:text-text',
          className,
        )}
      >
        {/* A branch name is arbitrarily long and the trigger sits in a header
            row, so it ellipsizes; the chevron stays, because it says "menu". */}
        <span className="truncate">
          {prefix} {value ?? '…'}
        </span>
        <IconChevronDown size={12} className="shrink-0 text-icon" />
      </ComboboxTrigger>
      <ComboboxContent align="end">
        <ComboboxInput placeholder="Find a branch…" />
        <ComboboxList label={`${prefix} branch`} className="font-mono text-xs">
          <ComboboxEmpty>
            {offered.length === 0 ? 'No branches to land on' : 'No branch matches'}
          </ComboboxEmpty>
          {main ? (
            <>
              <ComboboxGroup heading="Detected main line">{row(main)}</ComboboxGroup>
              {others.length > 0 && (
                <ComboboxGroup heading="Other local branches">{others.map(row)}</ComboboxGroup>
              )}
            </>
          ) : (
            others.map(row)
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

const LAP_HEAD = 'flex items-center gap-2 py-2 text-xs font-medium'

/**
 * Rows under `Lap N` headers — the ticket ledger and the notes inbox. The
 * current lap is an always-open section; earlier laps are a `<details>` (with
 * a rotating chevron and an animated height) that opens on a click. A feature
 * still on lap 1 gets no headers at all (ADR-0010 §4). That suppression keys on
 * the feature's lap, never on how many laps have rows.
 *
 * A surface that frames its rows passes `headClassName` for its headers.
 */
export function LapSections<T extends { lap: number }>({
  groups,
  currentLap,
  meta,
  headClassName,
  children,
}: {
  groups: LapGroup<T>[]
  /** The feature's own lap — what decides whether headers show at all. */
  currentLap: number
  /** One line about what a lap holds, shown beside its number. */
  meta: (group: LapGroup<T>) => string
  /** Extra utilities on each lap header, for a surface that frames its rows. */
  headClassName?: string
  children: (rows: T[]) => ReactNode
}) {
  if (currentLap <= 1) return <>{children(groups.flatMap((g) => g.rows))}</>

  return (
    <>
      {groups.map((g) => {
        const head = (
          <>
            <span>Lap {g.lap}</span>
            <span className="font-normal text-text-tertiary">{meta(g)}</span>
          </>
        )
        return g.current ? (
          <section key={g.lap}>
            <div className={cx(LAP_HEAD, headClassName, 'text-text-secondary')}>{head}</div>
            {children(g.rows)}
          </section>
        ) : (
          <details className="group/lap" data-disclosure="" key={g.lap}>
            <summary
              className={cx(
                LAP_HEAD,
                headClassName,
                'cursor-pointer list-none text-text-tertiary hover:text-text [&::-webkit-details-marker]:hidden',
              )}
            >
              <IconChevronRight
                size={12}
                className="shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-open/lap:rotate-90"
              />
              {head}
            </summary>
            {children(g.rows)}
          </details>
        )
      })}
    </>
  )
}

type NoteThumbnailSize = 'md' | 'sm'

const NOTE_THUMBNAIL_SIZE: Record<NoteThumbnailSize, string> = {
  md: 'h-[54px] w-24 rounded-md',
  sm: 'h-[26px] w-10 rounded-sm cursor-zoom-in',
}

/**
 * The picture a note is evidence for, as the button that opens it in the app's
 * lightbox. Renders nothing for a note without a picture. `md` ~96×54 (review
 * rows) · `sm` ~40×26 (the inbox's dense rows).
 */
export function NoteThumbnail({
  url,
  onOpen,
  size = 'md',
}: {
  url: string | null | undefined
  onOpen: (url: string) => void
  size?: NoteThumbnailSize
}) {
  if (!url) return null
  return (
    <button
      type="button"
      className={cx(
        'shrink-0 cursor-pointer overflow-hidden border border-border bg-surface-inset p-0',
        'transition-colors duration-(--dur-1) ease-app hover:border-border-strong',
        NOTE_THUMBNAIL_SIZE[size],
      )}
      title="see the whole picture"
      onClick={() => onOpen(url)}
    >
      <img src={url} alt="the picture attached to this note" className="h-full w-full object-cover" />
    </button>
  )
}
