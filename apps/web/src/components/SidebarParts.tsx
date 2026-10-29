import { Fragment, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { cx, IconButton, StatusDot, Tooltip } from '../ui'
import type { StatusTone } from '../ui'
import type { FeatureListItem } from '../lib/api'
import type { ThreadEntry, ThreadState } from '../lib/chat-thread'
import { ThreadStateMark } from './chat/thread/ThreadState'
import {
  needsMe,
  progressState,
  READY_TO_TEST,
  rowChip,
  ticketProgress,
  ticketShare,
  triageOf,
} from '../lib/feature-ui'
import { relTime } from '../lib/format'
import type { NotifyState } from '../lib/notifications'
import {
  IconActivity,
  IconArrowRight,
  IconBell,
  IconBellOff,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconMessage,
  IconMoon,
  IconOrchestrator,
  IconPlay,
  IconPlus,
  IconSettings,
  IconShield,
  IconStop,
  IconSun,
  ProgressIcon,
} from '../icons'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'

/**
 * The project sidebar's pieces, as markup over resolved values (DESIGN.md
 * §Frame, sidebar notes). The `Sidebar` owns the queries and composes them:
 *
 * - the {@link OrchestratorCard} under the head, over a {@link SidebarBackdrop};
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

/** A shade off the canvas: the hover fill, the same as every row's in the app. */
const HOVER = 'hover:bg-surface-hover'
/** The card (theme.css `card`): the selected row, the Working bay, a live drive. */
export const SIDEBAR_CARD = 'card rounded-lg'

/** The glyph a row wears: the feature's landed share of tickets (decision 9). */
export function FeatureProgressIcon({ f, size, label }: { f: FeatureListItem; size?: number; label?: string }) {
  return <ProgressIcon state={progressState(f)} progress={ticketShare(f)} size={size} label={label} />
}

/** A waiting reason as row words: its first letter capitalised ("Stopped"). */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * A row's second line: where the feature is, in words. A started feature with
 * no agent at work and nothing asked of you is simply in progress.
 */
export function featureStateWords(f: FeatureListItem): string {
  const lane = triageOf(f)
  const progress = ticketProgress(f)
  if (lane === 'needsYou') {
    // An Up next feature that cannot start by itself (its hover says why).
    if (f.status === 'draft') return "Won't start by itself"
    const nm = needsMe(f)
    if (nm?.kind === 'waiting') return nm.label === READY_TO_TEST ? 'Ready to test' : capitalise(nm.label)
    return 'Waiting on you'
  }
  if (lane === 'agentWorking') return f.activeRun ? `Working${progress ? ` · ${progress}` : ''}` : 'Agent working'
  // Up next says what it starts after; a backlog draft whether it could start.
  if (f.status === 'draft') return rowChip(f).text
  if (f.status === 'shipped') return 'Shipped'
  if (f.status === 'archived') return 'Archived'
  return 'In progress'
}

/** The one trailing dot: amber when it needs you; none otherwise. */
function rowDot(f: FeatureListItem): StatusTone | undefined {
  return triageOf(f) === 'needsYou' ? 'warning' : undefined
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
 * A row's hover controls ("+", "…") show on hover or keyboard focus, and the
 * marks they cover hide on exactly the same: a mouse click leaves focus in the
 * row but is neither, so the two never show at once.
 */
const REVEAL_NAV = 'opacity-0 group-hover/nav:opacity-100 group-has-[:focus-visible]/nav:opacity-100'
const CONCEAL_NAV = 'group-hover/nav:opacity-0 group-has-[:focus-visible]/nav:opacity-0'

/** The chevron that folds and unfolds the open row's threads (threads-in-the-sidebar decision 10). */
function FoldToggle({ folded, onToggle, what }: { folded: boolean; onToggle: () => void; what: string }) {
  return (
    <span data-fold-toggle="" className="inline-flex">
      <IconButton
        size="sm"
        label={folded ? `Show ${what}` : `Hide ${what}`}
        icon={<IconChevronRight className={cx('transition-transform duration-(--dur-2) ease-app', !folded && 'rotate-90')} />}
        onClick={onToggle}
      />
    </span>
  )
}

/**
 * The two-line row every sidebar row is drawn on: a 14px title with an
 * optional trailing dot, then a 12px line of glyph, words and an aside. The
 * menu is a hover "…" or a right-click. Selected, it becomes a card; `nested`
 * (inside a card) takes the smaller radius. A `toggle` (the open feature's
 * fold chevron) stays at the title line's end, the hover controls beside it.
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
  flat = false,
  nested = false,
  onClick,
  actions,
  toggle,
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
  /** Active inside a card that already marks it (the open feature with its threads): no fill of its own. */
  flat?: boolean
  nested?: boolean
  onClick?: () => void
  actions?: ReactNode
  toggle?: ReactNode
}) {
  return (
    <div
      className={cx(
        'group/nav relative shrink-0 transition-colors duration-(--dur-1) ease-app',
        nested ? 'rounded-md' : 'rounded-lg',
        active && !flat ? SIDEBAR_CARD : HOVER,
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
        <span className={cx('flex min-w-0 items-center gap-2', toggle !== undefined && 'pr-6')}>
          <span
            className={cx(
              'min-w-0 flex-1 truncate text-md',
              active ? 'font-medium text-text' : quiet ? 'text-text-secondary' : 'text-text',
            )}
          >
            {title}
          </span>
          {dot && (
            <span className={cx('transition-opacity duration-(--dur-1)', CONCEAL_NAV)}>
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
        <span
          data-row-actions=""
          className={cx(
            'absolute top-1.5 flex items-center transition-opacity duration-(--dur-1)',
            toggle !== undefined ? 'right-7' : 'right-1',
            REVEAL_NAV,
          )}
        >
          {actions}
        </span>
      )}
      {toggle !== undefined && <span className="absolute top-1.5 right-1">{toggle}</span>}
    </div>
  )
}

/** New thread: the "+" on the open feature's row and on the open Orchestrator card. */
function NewThreadButton({ onClick }: { onClick: () => void }) {
  return (
    <span data-new-thread="" className="inline-flex">
      <IconButton size="sm" label="New thread" icon={<IconPlus />} onClick={onClick} />
    </span>
  )
}

/**
 * One feature: its title, then its progress glyph, where it is in words and how
 * long ago it last moved. Working rows' words shimmer.
 */
export function SidebarFeatureRow({
  f,
  active,
  onSelect,
  actions,
  nested = false,
  onNewThread,
  threads,
  folded = false,
  onToggleThreads,
}: {
  f: FeatureListItem
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
  nested?: boolean
  /** The open feature's "+": a new side thread. */
  onNewThread?: () => void
  /**
   * The open feature's {@link SidebarThreadList}, once it has more than its
   * main chat: unfolded, the row and its threads share one card.
   */
  threads?: ReactNode
  /** The human folded the open feature's threads away (decision 10). */
  folded?: boolean
  /** With `threads`: the chevron that folds and unfolds them. */
  onToggleThreads?: () => void
}) {
  const shown = folded ? undefined : threads
  const lane = triageOf(f)
  const nm = lane === 'needsYou' ? needsMe(f) : null
  const words = featureStateWords(f)
  const menu = actions.length > 0 ? <FeatureActionsMenu actions={actions} /> : undefined
  const row = (
    <TwoLineRow
      title={f.title}
      tooltip={nm ? `${f.title} — ${nm.label}` : f.status === 'draft' ? `${f.title} — ${rowChip(f).title}` : f.title}
      glyph={<FeatureProgressIcon f={f} size={12} />}
      words={words}
      wordsClassName={cx(
        lane === 'agentWorking' && 'text-shimmer',
        nm && (nm.kind === 'stuck' ? 'text-danger-text' : 'text-text-secondary'),
      )}
      aside={relTime(f.lastActivityAt)}
      dot={rowDot(f)}
      quiet={f.status === 'draft' || f.status === 'shipped' || f.status === 'archived'}
      active={active}
      flat={shown !== undefined}
      nested={nested || shown !== undefined}
      onClick={() => onSelect(f.id)}
      actions={
        onNewThread || menu ? (
          <>
            {onNewThread && <NewThreadButton onClick={onNewThread} />}
            {menu}
          </>
        ) : undefined
      }
      toggle={
        threads !== undefined && onToggleThreads ? (
          <FoldToggle folded={folded} onToggle={onToggleThreads} what="threads" />
        ) : undefined
      }
    />
  )
  if (shown === undefined) return row
  return (
    <div data-open-feature="" className={cx(SIDEBAR_CARD, nested && 'rounded-md', 'flex shrink-0 flex-col p-1')}>
      {row}
      {shown}
    </div>
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
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fill-well px-1.5 text-xs text-text-secondary tabular-nums">
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
      <span className={cx('text-md', live ? 'font-medium text-text' : 'text-text-secondary group-hover/head:text-text')}>
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
 * Absent when empty. Folded unless `defaultOpen`; `open`/`onOpenChange` to control it.
 */
export function Shelf({
  icon,
  label,
  features,
  renderRow,
  cap,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
}: {
  icon: ReactNode
  label: string
  features: FeatureListItem[]
  renderRow: (f: FeatureListItem) => ReactNode
  cap?: number
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(defaultOpen)
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
// Threads
// ---------------------------------------------------------------------------

/**
 * The rows a thread list shows (threads-in-the-sidebar decision 3): the first
 * `cap` in the order given (the main chat, then newest started) and, past
 * them, the one in front and any working or waiting on you, in place.
 */
export function visibleThreads(
  threads: readonly ThreadEntry[],
  current: string | null,
  cap = 5,
): { shown: ThreadEntry[]; hidden: number } {
  const shown = threads.filter((t, i) => i < cap || t.id === current || t.state !== 'idle')
  return { shown, hidden: threads.length - shown.length }
}

/**
 * A thread's leading mark, in a fixed column so the titles after it line up:
 * a spinner while it works, the amber dot while it waits on you, the chat glyph
 * at rest.
 */
export function ThreadGlyph({ state }: { state: ThreadState }) {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon">
      {state === 'idle' ? <IconMessage size={14} /> : <ThreadStateMark state={state} />}
    </span>
  )
}

/**
 * One thread under its feature or the Orchestrator, on one line in three
 * columns: its {@link ThreadGlyph}, its title, and how long ago it moved. Its
 * "…" (hover, right-click) holds Rename, Export and, on an open scenario
 * chat, its close (decision 5).
 */
export function SidebarThreadRow({
  thread,
  active,
  onOpen,
  actions,
}: {
  thread: ThreadEntry
  active: boolean
  onOpen: (id: string) => void
  actions: FeatureAction[]
}) {
  return (
    <div
      className={cx(
        'group/thread relative shrink-0 rounded-md transition-colors duration-(--dur-1) ease-app',
        active ? 'card' : HOVER,
      )}
      onContextMenu={actions.length > 0 ? openRowMenu : undefined}
    >
      <button
        type="button"
        title={thread.title}
        aria-current={active ? 'page' : undefined}
        onClick={() => onOpen(thread.id)}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[inherit] px-2.5 text-left"
      >
        <ThreadGlyph state={thread.state} />
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-md',
            active ? 'font-medium text-text' : thread.state === 'waiting' ? 'text-text' : 'text-text-secondary',
          )}
        >
          {thread.title}
        </span>
        <span
          className={cx(
            'shrink-0 text-xs text-text-tertiary tabular-nums transition-opacity duration-(--dur-1)',
            actions.length > 0 && 'group-hover/thread:opacity-0 group-has-[:focus-visible]/thread:opacity-0',
          )}
        >
          {thread.updatedAt > 0 && relTime(thread.updatedAt)}
        </span>
      </button>
      {actions.length > 0 && (
        <span className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-1) group-hover/thread:opacity-100 group-has-[:focus-visible]/thread:opacity-100">
          <FeatureActionsMenu actions={actions} label="Thread actions" />
        </span>
      )}
    </div>
  )
}

/**
 * A thread list's last row, in the rows' columns: "Show N more" opens the rest
 * in place; "All N conversations" goes where they live.
 */
export function ThreadListMore({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-xs text-text-tertiary transition-colors duration-(--dur-1) ease-app hover:text-text-secondary"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon">{icon}</span>
      {label}
    </button>
  )
}

/**
 * The open feature's or the Orchestrator's threads in the order given, five
 * and then the rest: a feature's open in place ("Show N more"); the
 * Orchestrator's are its page's conversation list (`more`, "All N conversations").
 */
export function SidebarThreadList({
  threads,
  current,
  onOpen,
  actionsFor,
  more,
  label = 'Threads',
}: {
  threads: readonly ThreadEntry[]
  /** The thread in front, or null when none is (the Orchestrator page at rest). */
  current: string | null
  onOpen: (id: string) => void
  actionsFor: (t: ThreadEntry) => FeatureAction[]
  /** Where the rest live, instead of opening in place. */
  more?: () => void
  label?: string
}) {
  const [all, setAll] = useState(false)
  const { shown, hidden } = all ? { shown: [...threads], hidden: 0 } : visibleThreads(threads, current)
  return (
    <ul aria-label={label} className="m-0 flex animate-rise-in list-none flex-col gap-px p-0">
      {shown.map((t, i) => (
        <li key={t.id} className="flex flex-col gap-px">
          {/* Divided: a hairline from the title column to the edge, between thread rows. */}
          {i > 0 && <span aria-hidden className="mr-2.5 ml-[34px] h-px bg-border-subtle" />}
          <SidebarThreadRow thread={t} active={t.id === current} onOpen={onOpen} actions={actionsFor(t)} />
        </li>
      ))}
      {hidden > 0 && (
        <li>
          {more ? (
            <ThreadListMore label={`All ${threads.length} conversations`} icon={<IconArrowRight size={12} />} onClick={more} />
          ) : (
            <ThreadListMore label={`Show ${hidden} more`} icon={<IconChevronDown size={12} />} onClick={() => setAll(true)} />
          )}
        </li>
      )}
    </ul>
  )
}


// ---------------------------------------------------------------------------
// The Orchestrator
// ---------------------------------------------------------------------------

/**
 * The project's own door, and the one card the accent fills: a dark accent
 * wash from its icon side, a fine accent grid fading in from the far corner of
 * its head, the hub in a small accent tile. Still at rest; on hover the hub
 * lights its nodes in turn and a sheen crosses the head (`orchestrator-beat`).
 * Open, its chats list inside the same card under a hairline, so they read as
 * the Orchestrator's and not as the features below (threads-in-the-sidebar).
 */
export function OrchestratorCard({
  status,
  state,
  active,
  onOpen,
  actions,
  title,
  onNewThread,
  threads,
  folded = false,
  onToggleThreads,
}: {
  /** The second line: what it holds ("Waiting for you · 2 notes"). */
  status: string
  /** Its chats' state, marked as every thread list marks it: a spinner working, the amber dot waiting. */
  state: ThreadState
  active: boolean
  onOpen: () => void
  actions: FeatureAction[]
  title?: string
  /** While it is open: "+", a new project chat. */
  onNewThread?: () => void
  /** While it is open: its {@link SidebarThreadList}, inside the card unless `folded`. */
  threads?: ReactNode
  /** The human folded its chats away (decision 10). */
  folded?: boolean
  /** With `threads`: the chevron that folds and unfolds them, in place of the "go" chevron. */
  onToggleThreads?: () => void
}) {
  const toggles = threads !== undefined && onToggleThreads !== undefined
  const shown = folded ? undefined : threads
  return (
    <div
      className={cx(
        'relative isolate shrink-0 overflow-hidden rounded-lg ring-1 ring-inset',
        'bg-[linear-gradient(100deg,color-mix(in_oklab,var(--color-accent)_16%,var(--color-canvas)),color-mix(in_oklab,var(--color-accent)_5%,var(--color-canvas))_70%)]',
        'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_7%,transparent)]',
        active
          ? 'ring-[color-mix(in_oklab,var(--color-accent)_55%,transparent)]'
          : 'ring-[color-mix(in_oklab,var(--color-accent)_28%,transparent)]',
      )}
    >
      <div
        className="orchestrator-beat group/nav relative isolate overflow-hidden"
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
          className={cx('flex w-full cursor-pointer items-center gap-3 py-2.5 pl-2.5 text-left', toggles ? 'pr-9' : 'pr-2.5')}
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-accent-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_12%,transparent)] ring-1 ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] ring-inset">
            <IconOrchestrator size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-md font-semibold tracking-tight text-text">Orchestrator</span>
            <span className="truncate text-xs text-[color-mix(in_oklab,var(--color-accent-text)_70%,var(--color-text-tertiary))]">
              {status}
            </span>
          </span>
          <span className={cx('flex items-center gap-2 transition-opacity duration-(--dur-1)', CONCEAL_NAV)}>
            <ThreadStateMark state={state} />
            {!toggles && <IconChevronRight size={14} className="text-icon" />}
          </span>
        </button>
        {(actions.length > 0 || onNewThread) && (
          <span
            data-row-actions=""
            className={cx(
              'absolute top-1/2 flex -translate-y-1/2 items-center transition-opacity duration-(--dur-1)',
              toggles ? 'right-8' : 'right-1.5',
              REVEAL_NAV,
            )}
          >
            {onNewThread && <NewThreadButton onClick={onNewThread} />}
            <FeatureActionsMenu actions={actions} label="Project actions" />
          </span>
        )}
        {toggles && onToggleThreads && (
          <span className="absolute top-1/2 right-1.5 -translate-y-1/2">
            <FoldToggle folded={folded} onToggle={onToggleThreads} what="conversations" />
          </span>
        )}
      </div>
      {shown !== undefined && (
        <div className="border-t border-[color-mix(in_oklab,var(--color-accent)_22%,transparent)] p-1">{shown}</div>
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
          <span className="truncate text-md text-text">{label}</span>
          <span className="truncate text-xs text-text-tertiary">{detail}</span>
        </span>
        <span className={cx('transition-opacity duration-(--dur-1)', onStop && CONCEAL_NAV)}>
          <StatusDot tone="live" />
        </span>
      </button>
      {onStop && (
        <span className={cx('absolute top-1/2 right-1.5 -translate-y-1/2 transition-opacity duration-(--dur-1)', REVEAL_NAV)}>
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

/**
 * The halftone's mask: one dot per 8px cell, its radius shrinking from 1.1px
 * with distance from the head's top centre until it is gone. The tile is 640px
 * wide so the widest sidebar (420px) never meets its edge; the fade is sized to
 * a 320px head, so the texture looks the same at any width. Radii round to
 * 0.1px and each size is one stroked path of round-capped zero-length lines, so
 * the whole mask is a handful of paths, built once.
 */
const HALFTONE_MASK = (() => {
  const w = 640
  const h = 256
  const pitch = 8
  const rx = 320 * 1.15
  const ry = h * 1.15
  const bySize = new Map<number, string>()
  for (let y = pitch / 2; y < h; y += pitch)
    for (let x = pitch / 2; x < w; x += pitch) {
      const r = Math.round(11 * (1 - Math.hypot((x - w / 2) / rx, y / ry))) / 10
      if (r >= 0.2) bySize.set(r, `${bySize.get(r) ?? ''}M${x} ${y}h0`)
    }
  const paths = [...bySize].map(([r, d]) => `<path d='${d}' stroke-width='${(2 * r).toFixed(1)}'/>`).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' stroke='black' stroke-linecap='round'>${paths}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
})()

/**
 * Behind the sidebar's head: a static halftone, dots shrinking away from the
 * top centre. The dots are the text colour at 6%, so they read in both themes.
 */
export function SidebarBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 overflow-hidden">
      <div
        className="absolute top-0 left-1/2 h-64 w-[640px] -translate-x-1/2 bg-[color-mix(in_oklab,var(--color-text)_6%,transparent)]"
        style={{ maskImage: HALFTONE_MASK }}
      />
    </div>
  )
}
