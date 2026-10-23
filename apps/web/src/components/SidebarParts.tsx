import { Fragment, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { cx, IconButton, StatusDot, Tooltip } from '../ui'
import type { StatusTone } from '../ui'
import type { FeatureListItem } from '../lib/api'
import { needsMe, rowChip, ticketProgress, triageOf } from '../lib/feature-ui'
import { relTime } from '../lib/format'
import type { NotifyState } from '../lib/notifications'
import {
  IconActivity,
  IconBell,
  IconBellOff,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconMoon,
  IconOrchestrator,
  IconPlay,
  IconSettings,
  IconShield,
  IconStop,
  IconSun,
  PhaseIcon,
} from '../icons'
import type { PhaseIconPhase } from '../icons'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'

/**
 * The project sidebar's pieces, as markup over resolved values (DESIGN.md
 * §Frame, sidebar notes). The `Sidebar` owns the queries and composes them:
 *
 * - the {@link OrchestratorCard} under the head, over a {@link SidebarGrain};
 * - what needs you, unheaded: {@link PrepRow} while preparation is owed, then
 *   {@link SidebarFeatureRow}s waiting on you, then the stopped ones;
 * - the {@link WorkingShelf}, open, its rows in the bay;
 * - the folded {@link Shelf}s: Backlog, Shipped, Archived;
 * - the foot: {@link DriveCard}s, then the {@link SidebarStatusLine}.
 *
 * One material throughout: a card is `rounded-lg` (10px) on a fill a shade off
 * the canvas with a hairline edge, and rows inside one take `rounded-md` (6px)
 * so the corners nest. The Orchestrator is the one card the accent fills.
 */

/** A shade off the canvas: the hover fill. */
const HOVER = 'hover:bg-[color-mix(in_oklab,var(--color-text)_3.5%,transparent)]'
/** The card: the selected row, the Working bay, a live drive. */
export const SIDEBAR_CARD =
  'rounded-lg bg-[color-mix(in_oklab,var(--color-text)_2.5%,transparent)] ring-1 ring-inset ring-border-subtle'

/** The glyph a row wears: its phase, or the draft ring for a parked idea. */
function rowPhase(f: FeatureListItem): PhaseIconPhase {
  return f.status === 'draft' ? 'draft' : f.phase
}

/**
 * A row's second line: where the feature is, in words. A started feature with
 * no agent at work and nothing asked of you has stopped — it sits with what
 * needs you, because someone has to start it again.
 */
export function featureStateWords(f: FeatureListItem): string {
  const lane = triageOf(f)
  const progress = ticketProgress(f)
  if (lane === 'needsYou') {
    const nm = needsMe(f)
    if (nm?.kind === 'attention') return 'Run failed'
    if (nm?.kind === 'ship') return 'Ready to test'
    if (nm?.kind === 'burn') return 'Tickets ready'
    return 'Waiting on you'
  }
  if (lane === 'agentWorking') return f.activeRun ? `Building${progress ? ` · ${progress}` : ''}` : 'Agent working'
  // A waiting draft says what it waits on (ADR-0013 decision 6); a ready one is just in the backlog.
  if (f.status === 'draft') return rowChip(f).text
  if (f.status === 'shipped') return 'Shipped'
  if (f.status === 'archived') return 'Archived'
  return progress ? `Stopped · ${progress}` : 'Stopped'
}

/** The one trailing dot: amber waiting on you, red a failure, grey stopped; none otherwise. */
function rowDot(f: FeatureListItem): StatusTone | undefined {
  const lane = triageOf(f)
  if (lane === 'needsYou') return needsMe(f)?.kind === 'attention' ? 'danger' : 'warning'
  if (lane === 'inProgress') return 'neutral'
  return undefined
}

/**
 * Open a row's "…" menu from a right-click: a Radix dropdown opens on the
 * pointer-down, so that is what its (hover-revealed) trigger is sent.
 */
function openRowMenu(e: ReactMouseEvent<HTMLDivElement>): void {
  const trigger = e.currentTarget.querySelector<HTMLElement>('[aria-haspopup="menu"]')
  if (!trigger) return
  e.preventDefault()
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
}

/**
 * The two-line row every sidebar row is drawn on: a 14px title with an
 * optional trailing dot, then a 12px line of glyph, words and an aside. The
 * menu is a hover "…" or a right-click. Selected, it becomes a card; `nested`
 * (inside a card) takes the smaller radius.
 */
function TwoLineRow({
  title,
  tooltip,
  glyph,
  words,
  wordsClassName,
  aside,
  dot,
  quiet = false,
  active = false,
  nested = false,
  onClick,
  actions,
}: {
  title: string
  tooltip?: string
  glyph: ReactNode
  words: string
  wordsClassName?: string
  aside?: ReactNode
  dot?: StatusTone
  quiet?: boolean
  active?: boolean
  nested?: boolean
  onClick?: () => void
  actions?: ReactNode
}) {
  return (
    <div
      className={cx(
        'group/nav relative shrink-0 transition-colors duration-(--dur-1) ease-app',
        nested ? 'rounded-md' : 'rounded-lg',
        active ? SIDEBAR_CARD : HOVER,
      )}
      onContextMenu={actions ? openRowMenu : undefined}
    >
      <button
        type="button"
        title={tooltip ?? title}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[inherit] px-2.5 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cx(
              'min-w-0 flex-1 truncate text-[14px] leading-5',
              active ? 'font-medium text-text' : quiet ? 'text-text-secondary' : 'text-text',
            )}
          >
            {title}
          </span>
          {dot && (
            <span className="transition-opacity duration-(--dur-1) group-hover/nav:opacity-0">
              <StatusDot tone={dot} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary">
          {glyph}
          <span className={cx('min-w-0 flex-1 truncate', wordsClassName)}>{words}</span>
          {aside !== undefined && <span className="shrink-0 tabular-nums">{aside}</span>}
        </span>
      </button>
      {actions && (
        <span className="absolute top-1.5 right-1 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/nav:opacity-100 group-hover/nav:opacity-100">
          {actions}
        </span>
      )}
    </div>
  )
}

/**
 * One feature: its title, then its phase glyph, where it is in words and how
 * long ago it last moved. Working rows' words shimmer; a failed run's go red.
 */
export function SidebarFeatureRow({
  f,
  active,
  onSelect,
  actions,
  nested = false,
}: {
  f: FeatureListItem
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
  nested?: boolean
}) {
  const lane = triageOf(f)
  const nm = lane === 'needsYou' ? needsMe(f) : null
  const words = featureStateWords(f)
  return (
    <TwoLineRow
      title={f.title}
      tooltip={nm ? `${f.title} — ${nm.label}` : f.title}
      glyph={<PhaseIcon phase={rowPhase(f)} size={12} />}
      words={words}
      wordsClassName={cx(
        lane === 'agentWorking' && 'text-shimmer',
        nm && (nm.kind === 'attention' ? 'text-danger' : 'text-text-secondary'),
      )}
      aside={relTime(f.lastActivityAt)}
      dot={rowDot(f)}
      quiet={f.status === 'draft' || f.status === 'shipped' || f.status === 'archived'}
      active={active}
      nested={nested}
      onClick={() => onSelect(f.id)}
      actions={actions.length > 0 ? <FeatureActionsMenu actions={actions} /> : undefined}
    />
  )
}

/** Preparation while it is owed: first among what needs you, on the same row. */
export function PrepRow({
  label,
  badge,
  title,
  active,
  onClick,
}: {
  label: string
  badge: string | null
  title: string
  active: boolean
  onClick: () => void
}) {
  return (
    <TwoLineRow
      title={label}
      tooltip={title}
      glyph={<IconShield size={12} className="shrink-0 text-icon" />}
      words={badge ?? 'Not prepared yet'}
      wordsClassName="text-text-secondary"
      dot="warning"
      active={active}
      onClick={onClick}
    />
  )
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

/** A shelf's count, in a small round well. */
export function ShelfCount({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-text)_6%,transparent)] px-1.5 text-xs text-text-secondary tabular-nums">
      {n}
    </span>
  )
}

/** A shelf's heading row: icon, name, count and a chevron that turns as it opens. */
function ShelfHead({
  icon,
  label,
  count,
  open,
  onToggle,
  live = false,
}: {
  icon: ReactNode
  label: string
  count: number
  open: boolean
  onToggle: () => void
  live?: boolean
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cx(
        'group/head flex h-10 w-full shrink-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left transition-colors duration-(--dur-1) ease-app',
        HOVER,
      )}
    >
      <span className={cx('inline-flex shrink-0 [&>svg]:size-4', live ? 'text-accent-text' : 'text-icon')}>{icon}</span>
      <span className={cx('text-[14px] leading-5', live ? 'font-medium text-text' : 'text-text-secondary group-hover/head:text-text')}>
        {label}
      </span>
      <ShelfCount n={count} />
      <span className="flex-1" />
      <IconChevronRight
        size={14}
        className={cx('text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')}
      />
    </button>
  )
}

/**
 * A folded shelf: Backlog, Shipped, Archived. Opened, its rows are the same
 * two-line rows as every lane; `cap` shows that many, then "Show N more".
 * Absent when empty. Folded by default; `open`/`onOpenChange` to control it.
 */
export function Shelf({
  icon,
  label,
  features,
  renderRow,
  cap,
  open: openProp,
  onOpenChange,
}: {
  icon: ReactNode
  label: string
  features: FeatureListItem[]
  renderRow: (f: FeatureListItem) => ReactNode
  cap?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const [all, setAll] = useState(false)
  const open = openProp ?? openState
  if (features.length === 0) return null
  const toggle = () => {
    setOpenState(!open)
    onOpenChange?.(!open)
  }
  const visible = cap !== undefined && !all ? features.slice(0, cap) : features
  const rest = features.length - visible.length
  return (
    <section aria-label={label} className="flex flex-col gap-1 py-1">
      <ShelfHead icon={icon} label={label} count={features.length} open={open} onToggle={toggle} />
      {open && (
        <div className="flex animate-rise-in flex-col gap-1 pb-1">
          {visible.map(renderRow)}
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-left text-xs text-text-tertiary transition-colors duration-(--dur-1) ease-app hover:text-text-secondary"
            >
              <IconChevronDown size={12} className="text-icon" />
              Show {rest} more
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Working: a shelf that starts open, its rows inside the bay — a card with one
 * accent light travelling its edge. Absent when no agent is at work.
 */
export function WorkingShelf({
  features,
  renderRow,
}: {
  features: FeatureListItem[]
  /** Draws one row; `nested` is true — the row sits inside the bay. */
  renderRow: (f: FeatureListItem, nested: true) => ReactNode
}) {
  const [open, setOpen] = useState(true)
  if (features.length === 0) return null
  return (
    <section aria-label="Working" className="flex flex-col gap-1">
      <ShelfHead
        icon={<IconActivity />}
        label="Working"
        count={features.length}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        live
      />
      {open && (
        <div className={cx(SIDEBAR_CARD, 'orbit-light relative flex animate-rise-in flex-col p-1')}>
          {features.map((f, i) => (
            <Fragment key={f.id}>
              {i > 0 && <span aria-hidden className="mx-2.5 h-px bg-border-subtle" />}
              {renderRow(f, true)}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The Orchestrator
// ---------------------------------------------------------------------------

/**
 * The project's own door, and the one card the accent fills: a dark accent
 * wash from its icon side, a fine accent grid fading in from the far corner,
 * the hub in a small accent tile. Still at rest; on hover the hub lights its
 * nodes in turn and a sheen crosses the card (`orchestrator-beat`).
 */
export function OrchestratorCard({
  status,
  waiting,
  active,
  onOpen,
  actions,
  title,
}: {
  /** The second line: what it holds ("Waiting on you · 2 notes"). */
  status: string
  /** The project conversation waits on you: the amber dot. */
  waiting: boolean
  active: boolean
  onOpen: () => void
  actions: FeatureAction[]
  title?: string
}) {
  return (
    <div
      className={cx(
        'orchestrator-beat group/nav relative isolate shrink-0 overflow-hidden rounded-lg ring-1 ring-inset',
        'bg-[linear-gradient(100deg,color-mix(in_oklab,var(--color-accent)_16%,var(--color-canvas)),color-mix(in_oklab,var(--color-accent)_5%,var(--color-canvas))_70%)]',
        'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_7%,transparent)]',
        active
          ? 'ring-[color-mix(in_oklab,var(--color-accent)_55%,transparent)]'
          : 'ring-[color-mix(in_oklab,var(--color-accent)_28%,transparent)]',
      )}
      onContextMenu={actions.length > 0 ? openRowMenu : undefined}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-2/3 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--color-accent)_14%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-accent)_14%,transparent)_1px,transparent_1px)] [background-size:12px_12px] [mask-image:linear-gradient(to_left,black,transparent)]"
      />
      <span
        aria-hidden
        data-sheen
        className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/2 -translate-x-[120%] bg-[linear-gradient(100deg,transparent,color-mix(in_oklab,var(--color-text)_7%,transparent),transparent)]"
      />
      <button
        type="button"
        onClick={onOpen}
        title={title}
        aria-current={active ? 'page' : undefined}
        className="flex w-full cursor-pointer items-center gap-3 px-2.5 py-2.5 text-left"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-accent-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_12%,transparent)] ring-1 ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] ring-inset">
          <IconOrchestrator size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14px] leading-5 font-semibold tracking-tight text-text">Orchestrator</span>
          <span className="truncate text-xs text-[color-mix(in_oklab,var(--color-accent-text)_70%,var(--color-text-tertiary))]">
            {status}
          </span>
        </span>
        <span className="flex items-center gap-2 transition-opacity duration-(--dur-1) group-hover/nav:opacity-0">
          {waiting && <StatusDot tone="warning" />}
          <IconChevronRight size={14} className="text-icon" />
        </span>
      </button>
      {actions.length > 0 && (
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/nav:opacity-100 group-hover/nav:opacity-100">
          <FeatureActionsMenu actions={actions} label="Project actions" />
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Foot and backdrop
// ---------------------------------------------------------------------------

/**
 * A live drive, as a card: what is driving (Test drive, Project drive), what
 * it drives in words, and Stop on hover when it can be stopped from here.
 */
export function DriveCard({
  label,
  detail,
  title,
  onOpen,
  onStop,
  stopping = false,
}: {
  label: string
  /** The feature's title, or the branch for a project drive. */
  detail: ReactNode
  title?: string
  onOpen?: () => void
  onStop?: () => void
  stopping?: boolean
}) {
  return (
    <div className={cx(SIDEBAR_CARD, 'group/nav relative shrink-0')}>
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[inherit] px-2.5 py-2 text-left"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-accent-text">
          <IconPlay size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14px] leading-5 text-text">{label}</span>
          <span className="truncate text-xs text-text-tertiary">{detail}</span>
        </span>
        <span className={cx('transition-opacity duration-(--dur-1)', onStop && 'group-hover/nav:opacity-0')}>
          <StatusDot tone="live" />
        </span>
      </button>
      {onStop && (
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/nav:opacity-100 group-hover/nav:opacity-100">
          <IconButton size="sm" label={`Stop the ${label.toLowerCase()}`} icon={<IconStop />} disabled={stopping} onClick={onStop} />
        </span>
      )}
    </div>
  )
}

const NOTIFY_LABEL: Record<NotifyState, string> = {
  on: 'Notifications on — turn off',
  off: 'Notifications off — turn on',
  blocked: 'Notifications blocked by the browser',
}

/**
 * The foot's last line, icons only: settings, theme and notifications on the
 * left; on the right the sandbox and the server's health as one glyph and dot,
 * the words in their tooltip. Shared with the portfolio home's sidebar.
 */
export function SidebarStatusLine({
  healthTone,
  healthTip,
  sandbox,
  notify,
  theme,
  onToggleTheme,
  onOpenSettings,
}: {
  healthTone: StatusTone
  healthTip: string
  sandbox: string
  /** `null` when the browser has no Notification API to toggle. */
  notify: { state: NotifyState; title: string; onToggle: () => void } | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenSettings?: () => void
}) {
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className="flex h-8 items-center gap-0.5 pl-0.5">
      {onOpenSettings && <IconButton size="sm" label="Settings" icon={<IconSettings />} onClick={onOpenSettings} />}
      <IconButton
        size="sm"
        label={`Switch to ${next} theme`}
        icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
        onClick={onToggleTheme}
      />
      {notify && (
        <IconButton
          size="sm"
          label={notify.state === 'blocked' ? notify.title : NOTIFY_LABEL[notify.state]}
          icon={notify.state === 'on' ? <IconBell /> : <IconBellOff />}
          active={notify.state === 'on'}
          onClick={notify.onToggle}
        />
      )}
      <span className="flex-1" />
      <Tooltip label={`${healthTip} · agents run sandboxed via ${sandbox}`}>
        <span tabIndex={0} className="mr-2 inline-flex items-center gap-1.5 rounded-sm" data-health-tone={healthTone}>
          <IconCube size={14} className="text-icon" />
          <StatusDot tone={healthTone} />
        </span>
      </Tooltip>
    </div>
  )
}

/** Behind the sidebar's head: a fine static film grain, fading out downward. */
export function SidebarGrain() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
      <div className="film-grain absolute inset-0 opacity-[0.07] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    </div>
  )
}
