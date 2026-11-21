import { useState, type ReactNode } from 'react'
import { isReadyToTestWhy } from '@runcastle/core'
import { cx } from '../ui'
import type { FeatureListItem } from '../lib/api'
import { needsMe, triageOf, upNextProblem } from '../lib/feature-ui'
import { relTimeAgo } from '../lib/format'
import { workerGroups, WORKER_STATUS_WORDS, type WorkerEntry } from '../lib/workers'
import { IconAlert, IconChevronRight, IconMessage, IconPlus } from '../icons'
import { IconButton } from '../ui'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { openRowMenu, SIDEBAR_CARD, type FeatureWorkers } from './SidebarParts'

/**
 * The features inside an epic's card (docs/features/a-calmer-sidebar): what
 * needs you stands out, the rest folds away. Each feature is one line — its
 * mark in front, its title, and an arrow at the end when it has live workers —
 * with no status words and no progress ring (decisions 2, 5, 9). Features that need you come
 * first; every other one folds into one quiet line, "3 working · 1 idle",
 * opened per epic (decision 3). The feature in front always shows, folded or not.
 */

/** A title's room for one or two hover controls, kept while they show. */
const HOVER_ROOM_ONE = 'group-hover/nav:mr-5 group-has-[:focus-visible]/nav:mr-5'
const HOVER_ROOM_TWO = 'group-hover/nav:mr-11 group-has-[:focus-visible]/nav:mr-11'

/** A row's hover controls show on hover or keyboard focus. */
const CONCEAL = 'group-hover/nav:hidden group-has-[:focus-visible]/nav:hidden'
const REVEAL = 'opacity-0 group-hover/nav:opacity-100 group-has-[:focus-visible]/nav:opacity-100'

/** One feature in an epic's card, with what it takes to draw it. */
export interface EpicFeatureItem {
  feature: FeatureListItem
  /** Locked to its epic's autopilot: a lock, never amber; its needs are the epic's. */
  locked?: boolean
}

// ---------------------------------------------------------------------------
// Remembered folds: kept on this browser, closed by default.
// ---------------------------------------------------------------------------

function useStoredOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      if (next) localStorage.setItem(key, '1')
      else localStorage.removeItem(key)
    } catch {
      // localStorage unavailable (private mode): the fold still holds in-session.
    }
  }
  return [open, toggle]
}

const EPIC_FOLD_KEY = (epicId: string) => `runcastle.sidebar.epicOpen:${epicId}`
const WORKERS_OPEN_KEY = (featureId: string) => `runcastle.sidebar.workersOpen:${featureId}`

// ---------------------------------------------------------------------------
// The marks: one icon at the front of a row, in the app's own line style
// ---------------------------------------------------------------------------

/** What a row is waiting on: go test it, go answer it, or something broke (decision 10). */
export type NeedKind = 'ready' | 'question' | 'failed' | 'stuck'

/**
 * A row that needs you stands out in its epic's colour (`--need`, grey on a
 * card with none) and stays still: a tint behind it, its mark in a small tile,
 * an unread dot at its end, and a count in the epic's head. Only working rows
 * move, so motion always means "busy" and stillness plus colour means "you".
 */
const NEED_VARS = '[--need:var(--epic,var(--color-text-secondary))] [--need-text:var(--epic-text,var(--color-text))]'
const NEED_FILL = 'bg-[color-mix(in_oklab,var(--need)_10%,transparent)]'
/** A needs-you row's hover: its own tint, deeper, never the grey of a plain row. */
const NEED_HOVER = 'hover:bg-[color-mix(in_oklab,var(--need)_18%,transparent)]'
const NEED_TILE =
  'size-[18px] -m-px rounded-[5px] bg-[color-mix(in_oklab,var(--need)_20%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--need)_40%,transparent)] text-(--need-text)'

/** A mark outside the tray (an epic's own question), in the epic's colour, soft enough to sit beside grey. */
const SOFT_EPIC = 'text-[color-mix(in_oklab,var(--epic-text,var(--color-text-secondary))_85%,var(--color-text-tertiary))]'

const NEED_LABEL: Record<NeedKind, string> = { ready: 'Ready to test', question: 'Asks you', failed: 'Failed', stuck: "Can't start" }

/** Ready to test: an outlined play, drawn like the app's other line icons. */
function IconRun({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden>
      <path d="M5 3.6v8.8a.5.5 0 0 0 .76.43l7.04-4.4a.5.5 0 0 0 0-.86L5.76 3.17A.5.5 0 0 0 5 3.6z" />
    </svg>
  )
}

/** A row's mark: lit (the epic's look for "needs you") on a needs-you row, soft epic colour in an epic's head, red when something broke. */
export function NeedMark({ kind, soft = false, lit = false }: { kind: NeedKind; soft?: boolean; lit?: boolean }) {
  const danger = kind === 'failed' || kind === 'stuck'
  const tone = danger ? 'text-danger' : soft ? SOFT_EPIC : lit ? NEED_TILE : 'text-text-secondary'
  return (
    <span aria-label={NEED_LABEL[kind]} role="img" className={cx('relative inline-flex size-4 shrink-0 items-center justify-center', tone)}>
      {kind === 'ready' ? <IconRun /> : kind === 'question' ? <IconMessage size={14} /> : <IconAlert size={14} />}
    </span>
  )
}

/** How many rows in a list need you (not locked to autopilot): the head's count. */
export function needCount(items: readonly EpicFeatureItem[]): number {
  return items.filter((x) => !x.locked && triageOf(x.feature) === 'needsYou').length
}

/** A working row's mark: a small spinner, the one thing in the block that moves. */
function WorkingMark() {
  return (
    <span aria-label="Working" role="img" className="inline-flex size-4 shrink-0 items-center justify-center">
      <span className="size-3 rounded-full border-[1.5px] border-[color-mix(in_oklab,var(--color-text-tertiary)_30%,transparent)] border-t-text-tertiary [animation:spin_1.1s_linear_infinite]" />
    </span>
  )
}

/** Whether a feature has a failed live worker: the server sets no need for it, so the sidebar marks it red itself. */
function hasFailedWorker(workers: FeatureWorkers | undefined): boolean {
  return !!workers?.entries.some((w) => !w.old && w.status === 'failed')
}

/** A feature's leading mark: its autopilot lock, ready to test, a question, a failed worker, a stuck up-next, the spinner while it works, or none. */
function featureMark(f: FeatureListItem, lock: ReactNode | undefined, failed: boolean): ReactNode {
  if (lock !== undefined) return <span className="inline-flex size-4 shrink-0 items-center justify-center">{lock}</span>
  const need = needsMe(f)
  if (need) return <NeedMark lit kind={isReadyToTestWhy(need.why) ? 'ready' : 'question'} />
  if (failed) return <NeedMark kind="failed" />
  if (upNextProblem(f)) return <NeedMark kind="stuck" />
  if (triageOf(f) === 'working') return <WorkingMark />
  return null
}

/** The row's hover line: the full title, what it waits on (the reason the row no longer says) and since when. */
function featureTooltip(f: FeatureListItem, locked: boolean, failed: boolean): string {
  const ago = relTimeAgo(f.lastActivityAt)
  if (locked) return `${f.title} — on autopilot · ${ago}`
  const need = needsMe(f)
  if (need) return `${f.title} — ${need.why} · ${ago}`
  if (failed) return `${f.title} — a worker failed · ${ago}`
  const problem = upNextProblem(f)
  if (problem) return `${f.title} — ${problem}`
  return `${f.title} · ${ago}`
}

// ---------------------------------------------------------------------------
// One feature, one line: [mark] title ……… [arrow]
// ---------------------------------------------------------------------------

/** The arrow at a row's end that opens its live workers (decision 9). */
function Disclosure({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={open ? 'Hide workers' : 'Show workers'}
      onClick={onToggle}
      className="relative z-10 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-icon transition-colors duration-(--dur-1) ease-app hover:bg-fill-well hover:text-text-secondary"
    >
      <IconChevronRight size={12} className={cx('transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')} />
    </button>
  )
}

/** A row's hover controls, just before its arrow when it has one. */
function RowActions({ children, beforeArrow }: { children: ReactNode; beforeArrow: boolean }) {
  return (
    <span
      data-row-actions=""
      className={cx(
        'absolute top-1/2 z-10 flex -translate-y-1/2 items-center rounded-md transition-opacity duration-(--dur-1)',
        beforeArrow ? 'right-7' : 'right-1',
        REVEAL,
      )}
    >
      {children}
    </span>
  )
}

/**
 * A feature as one line: its mark in front, its title, and the arrow to its
 * live workers at the end. No time and no status words; the hover says both.
 * The whole row opens it; "+" and "…" show on hover.
 */
function EpicFeatureRow({
  f,
  active,
  onSelect,
  actions,
  onNewWorker,
  lock,
  workers,
  workersOpen = false,
  onToggleWorkers,
  failed = false,
}: {
  f: FeatureListItem
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
  onNewWorker?: (() => void) | undefined
  lock?: ReactNode
  /** Its live workers, when it has some. */
  workers?: readonly WorkerEntry[]
  workersOpen?: boolean
  onToggleWorkers?: () => void
  /** One of its live workers failed: the red "!" in front. */
  failed?: boolean
}) {
  const lane = triageOf(f)
  const asking = lock === undefined && lane === 'needsYou'
  const quiet = lane === 'upNext'
  const live = workers ?? []
  const arrow = live.length > 0 && !!onToggleWorkers
  const menu = actions.length > 0 ? <FeatureActionsMenu actions={actions} /> : undefined
  return (
    <div
      data-feature-row={f.id}
      data-needs-you={asking ? '' : undefined}
      className={cx(
        'group/nav relative flex h-8 shrink-0 items-center gap-2 rounded-md pr-1 pl-2 transition-colors duration-(--dur-1) ease-app',
        active ? SIDEBAR_CARD + ' rounded-md' : asking ? NEED_HOVER : 'hover:bg-surface-hover',
        asking && NEED_FILL,
      )}
      onContextMenu={menu ? openRowMenu : undefined}
    >
      <button
        type="button"
        title={featureTooltip(f, lock !== undefined, failed)}
        aria-label={f.title}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(f.id)}
        className="absolute inset-0 cursor-pointer rounded-[inherit]"
      />
      <span className="pointer-events-none inline-flex size-4 shrink-0 items-center justify-center">{featureMark(f, lock, failed)}</span>
      <span
        className={cx(
          'pointer-events-none min-w-0 flex-1 truncate text-md',
          active || asking ? 'text-text' : quiet ? 'text-text-tertiary' : 'text-text-secondary',
          active && 'font-medium',
          // Room for "+" and "…" while they show, so they never sit on the title.
          (menu || onNewWorker) && (onNewWorker && menu ? HOVER_ROOM_TWO : HOVER_ROOM_ONE),
        )}
      >
        {f.title}
      </span>
      {asking && (
        // The unread dot; it steps aside for "+" and "…" on hover.
        <span aria-hidden className={cx('pointer-events-none mr-1.5 size-2 shrink-0 rounded-full bg-(--need)', (menu || onNewWorker) && CONCEAL)} />
      )}
      {arrow ? (
        <Disclosure open={workersOpen} onToggle={onToggleWorkers} label={`${f.title}: ${live.length} worker${live.length === 1 ? '' : 's'}`} />
      ) : (
        <span aria-hidden className="w-1.5 shrink-0" />
      )}
      {(menu || onNewWorker) && (
        <RowActions beforeArrow={arrow}>
          {onNewWorker && <IconButton size="sm" label="New worker" icon={<IconPlus />} onClick={onNewWorker} />}
          {menu}
        </RowActions>
      )}
    </div>
  )
}

/** One live worker under its feature, as one line: its mark in front (asks, failed, stalled, working) and its label. */
function EpicWorkerRow({
  worker: w,
  active,
  onSelect,
  actions,
  lock,
}: {
  worker: WorkerEntry
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
  lock?: ReactNode
}) {
  const locked = lock !== undefined
  const asks = !locked && w.status === 'needs-you'
  const failed = w.status === 'failed'
  const menu = actions.length > 0 ? <FeatureActionsMenu actions={actions} label="Worker actions" /> : undefined
  // A stalled worker is its lead's to act on, not the human's (a-worker-never-shows-working-with-nothing-running decision 6): amber, not lit.
  const stalled = w.status === 'stalled'
  const mark = locked ? (
    lock
  ) : asks ? (
    <NeedMark kind="question" />
  ) : failed ? (
    <NeedMark kind="failed" />
  ) : stalled ? (
    <IconAlert size={14} className="text-warning" aria-label="Stalled" />
  ) : w.status === 'working' ? (
    <WorkingMark />
  ) : null
  return (
    <div
      className={cx(
        'group/nav relative flex h-7 shrink-0 items-center gap-2 rounded-md pr-2 pl-2 transition-colors duration-(--dur-1) ease-app',
        active ? SIDEBAR_CARD + ' rounded-md' : 'hover:bg-surface-hover',
      )}
      onContextMenu={menu ? openRowMenu : undefined}
    >
      <button
        type="button"
        title={`${w.label} — ${WORKER_STATUS_WORDS[w.status]}${w.purpose ? ` · ${w.purpose}` : ''}${w.updatedAt > 0 ? ` · ${relTimeAgo(w.updatedAt)}` : ''}`}
        aria-label={w.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(w.id)}
        className="absolute inset-0 cursor-pointer rounded-[inherit]"
      />
      <span className="pointer-events-none inline-flex size-4 shrink-0 items-center justify-center">{mark}</span>
      <span
        className={cx(
          'pointer-events-none min-w-0 flex-1 truncate text-sm',
          active || asks || failed ? 'text-text' : stalled ? 'text-warning-text' : 'text-text-secondary',
          active && 'font-medium',
          w.status === 'queued' && 'text-text-tertiary',
          menu && HOVER_ROOM_ONE,
        )}
      >
        {w.label}
      </span>
      {menu && <RowActions beforeArrow={false}>{menu}</RowActions>}
    </div>
  )
}

/** A feature and, opened, its live workers under it on a guide line. Finished workers are not drawn (decision 6); the arrow opens them (decision 9). */
function EpicFeature({
  item,
  active,
  onSelect,
  actions,
  onNewWorker,
  lock,
  workers,
}: {
  item: EpicFeatureItem
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
  onNewWorker?: (() => void) | undefined
  lock?: ReactNode
  workers?: FeatureWorkers | undefined
}) {
  const f = item.feature
  const [stored, toggle] = useStoredOpen(WORKERS_OPEN_KEY(f.id))
  const live = workers ? (({ needsYou, working }) => [...needsYou, ...working])(workerGroups(workers.entries)) : []
  // A worker whose chat is in front keeps its feature's workers open.
  const open = live.length > 0 && (stored || live.some((w) => w.id === workers?.current))
  const row = (
    <EpicFeatureRow
      f={f}
      active={active}
      onSelect={onSelect}
      actions={actions}
      onNewWorker={onNewWorker}
      lock={lock}
      workers={live}
      workersOpen={open}
      onToggleWorkers={toggle}
      failed={lock === undefined && hasFailedWorker(workers)}
    />
  )
  if (!open || !workers) return row
  return (
    <div data-feature-group={f.id} className="flex flex-col">
      {row}
      <div role="group" aria-label={`${f.title} · workers`} className="relative flex animate-rise-in flex-col gap-px pb-0.5">
        <span aria-hidden className="pointer-events-none absolute top-0.5 bottom-1.5 left-[15.5px] w-px bg-border-subtle" />
        <div className="ml-5 flex flex-col gap-px">
          {live.map((w) => (
            <EpicWorkerRow
              key={w.id}
              worker={w}
              active={w.id === workers.current}
              onSelect={workers.onOpen}
              actions={workers.actionsFor(w)}
              {...(lock !== undefined ? { lock } : {})}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** How the folded features read: "3 working · 1 idle · 1 up next", the empty counts left out. */
function foldWords(items: readonly EpicFeatureItem[]): { working: number; idle: number; upNext: number } {
  let working = 0
  let idle = 0
  let upNext = 0
  for (const { feature: f, locked } of items) {
    const lane = triageOf(f)
    if (lane === 'upNext') upNext++
    else if (locked ? f.working : lane === 'working') working++
    else idle++
  }
  return { working, idle, upNext }
}

/** The fold as a row like the others: the spinner in front while any work and it is closed, the counts, and its arrow at the end. */
function FoldLine({
  items,
  open,
  onToggle,
  label,
  workersFor,
}: {
  items: readonly EpicFeatureItem[]
  open: boolean
  onToggle: () => void
  label: string
  workersFor?: ((f: FeatureListItem) => FeatureWorkers | undefined) | undefined
}) {
  const { working, idle, upNext } = foldWords(items)
  // Something broke behind the fold (a failed worker, a stuck up-next): the red "!" in front while it is closed.
  const failed = items.some((x) => !x.locked && hasFailedWorker(workersFor?.(x.feature)))
  const stuck = items.some((x) => !x.locked && upNextProblem(x.feature))
  const words = [working > 0 && `${working} working`, idle > 0 && `${idle} idle`, upNext > 0 && `${upNext} up next`].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${label}: ${items.length} more feature${items.length === 1 ? '' : 's'}`}
      onClick={onToggle}
      className="flex h-7 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2 text-left text-xs text-text-tertiary transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text-secondary"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        {failed && !open ? <NeedMark kind="failed" /> : stuck && !open ? <NeedMark kind="stuck" /> : working > 0 && !open ? <WorkingMark /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate tabular-nums">{words}</span>
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <IconChevronRight size={12} className={cx('text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')} />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// The card's body
// ---------------------------------------------------------------------------

interface EpicFeatureListProps {
  /** Whose fold this is: the epic's chat id, or "other" for Other features. */
  foldId: string
  label: string
  items: readonly EpicFeatureItem[]
  currentFeature: string | null
  onSelect: (id: string) => void
  featureActions?: ((f: FeatureListItem) => FeatureAction[]) | undefined
  workersFor?: ((f: FeatureListItem) => FeatureWorkers | undefined) | undefined
  newWorkerFor?: ((f: FeatureListItem) => (() => void) | undefined) | undefined
  /** A locked feature's mark. */
  lockMark?: ReactNode
}

/** Every feature that doesn't need you folds, even a lone one: the human reads a bare row as one that wants a look. */
const FOLD_FROM = 1

/**
 * An epic's features: those that need you on top, each its own line; then the
 * rest behind one fold line. The feature in front sits above the fold line
 * while it is closed, so the sidebar always shows where you are.
 */
export function EpicFeatureList({
  foldId,
  label,
  items,
  currentFeature,
  onSelect,
  featureActions,
  workersFor,
  newWorkerFor,
  lockMark,
}: EpicFeatureListProps) {
  const [open, toggle] = useStoredOpen(EPIC_FOLD_KEY(foldId))
  const upfront = items.filter((x) => !x.locked && triageOf(x.feature) === 'needsYou')
  const rest = items.filter((x) => !upfront.includes(x))
  const folds = rest.length >= FOLD_FROM
  const pinned = folds && !open ? rest.filter((x) => x.feature.id === currentFeature) : []
  // Closed, with only the feature in front behind it, the fold would hold nothing: leave its line out.
  const foldLine = folds && (open || rest.length > pinned.length)
  const row = (x: EpicFeatureItem) => (
    <EpicFeature
      key={x.feature.id}
      item={x}
      active={x.feature.id === currentFeature}
      onSelect={onSelect}
      actions={featureActions?.(x.feature) ?? []}
      onNewWorker={newWorkerFor?.(x.feature)}
      {...(x.locked && lockMark !== undefined ? { lock: lockMark } : {})}
      workers={workersFor?.(x.feature)}
    />
  )
  if (items.length === 0) return null
  return (
    <div role="group" aria-label={label} className={cx('flex flex-col gap-px p-1', NEED_VARS)}>
      {upfront.length > 0 && (
        <div role="group" aria-label="Needs you" className="flex flex-col gap-0.5">
          {upfront.map(row)}
        </div>
      )}
      {pinned.map(row)}
      {upfront.length + pinned.length > 0 && foldLine && (
        <span aria-hidden className="mx-2.5 my-1 h-px bg-border-subtle" />
      )}
      {folds ? (
        foldLine && (
        <>
          <FoldLine
            items={open ? rest : rest.filter((x) => !pinned.includes(x))}
            open={open}
            onToggle={toggle}
            label={label}
            workersFor={workersFor}
          />
          {open && <div className="flex animate-rise-in flex-col gap-px">{rest.map(row)}</div>}
        </>
        )
      ) : (
        rest.map(row)
      )}
    </div>
  )
}
