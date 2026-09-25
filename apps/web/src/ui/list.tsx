import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { PhaseIcon } from '../icons'
import type { PhaseIconPhase } from '../icons'
import { cx } from './floating'
import { StatusDot, TONE_TEXT } from './status'
import type { StatusTone } from './status'

/**
 * Rows, groups and facts (DESIGN.md §Components): the sidebar's `NavItem`, the
 * content panel's `ListRow` inside a `List`, the group heading `SectionLabel`,
 * and the two ways state is said as text — `PropertyList` and `MetaLine`.
 */

/**
 * A group heading in the sidebar or over a list: 12px medium, sentence case,
 * `text-tertiary`, with an optional `count` and one trailing `action` (an
 * `IconButton size="sm"`). Never uppercase-tracked, never coloured. Pass
 * horizontal padding via `className` to line it up with the rows below.
 */
export function SectionLabel({
  children,
  count,
  action,
  className,
  id,
}: {
  children: ReactNode
  count?: ReactNode
  action?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div
      id={id}
      className={cx('flex h-7 min-w-0 items-center gap-2 text-xs font-medium text-text-tertiary', className)}
    >
      <span className="truncate">{children}</span>
      {count !== undefined && count !== null && (
        <span className="font-normal text-text-tertiary tabular-nums">{count}</span>
      )}
      {action && <span className="ml-auto flex shrink-0 items-center">{action}</span>}
    </div>
  )
}

/**
 * The 16px square a leading glyph sits in, so dots and icons line up. A
 * minimum, not a fixed size: a thumbnail (a note's picture) takes its own.
 */
function Leading({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-h-4 min-w-4 shrink-0 items-center justify-center">{children}</span>
}

/** The clickable part of a row: an `<a>` with `href`, else a `<button>`. */
function RowControl({
  href,
  onClick,
  current,
  title,
  label,
  expanded,
  className,
  children,
}: {
  href?: string
  onClick?: MouseEventHandler<HTMLElement>
  current?: boolean
  title?: string
  /** An accessible name that replaces the row's own text. */
  label?: string
  /** A row that opens something beneath it: `aria-expanded`. */
  expanded?: boolean
  className: string
  children: ReactNode
}) {
  if (href !== undefined) {
    return (
      <a
        href={href}
        onClick={onClick}
        aria-current={current ? 'page' : undefined}
        aria-label={label}
        title={title}
        className={cx(className, 'no-underline')}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      aria-expanded={expanded}
      title={title}
      className={className}
    >
      {children}
    </button>
  )
}

/**
 * One row of the sidebar: 32px, a leading icon (or phase glyph), a one-line
 * truncated label, optional trailing `dot` and `meta`. Selected (`active`) is
 * `surface-selected` + `text` + medium weight — nothing else.
 *
 * - `icon` | `phase` — the leading glyph (`phase` draws a `PhaseIcon`).
 * - `label` — one line; the full title lives in the page header. `title`
 *   sets the hover tooltip (defaults to the label when it is a string).
 * - `meta` — trailing count or fraction ("3/7"), `text-tertiary`, tabular.
 * - `dot` — a trailing `StatusDot` tone for a live state.
 * - `href` / `onClick` — renders an `<a>` or a `<button>`.
 * - `actions` — a trailing slot (usually an `IconButton size="sm"` "…")
 *   revealed on hover or keyboard focus, over the meta. Never visible at rest.
 * - `onContextMenu` — the row's menu by right-click; `onDoubleClick` — a
 *   second gesture on the row (the folder picker: enter *and* pick a repo).
 * - `tone="quiet"` — a 28px `text-xs text-tertiary` row with no glyph, its
 *   words lined up with the labels above: "Show all (N)", "Show archived".
 */
export function NavItem({
  icon,
  phase,
  label,
  meta,
  dot,
  active = false,
  href,
  onClick,
  actions,
  onContextMenu,
  onDoubleClick,
  tone = 'default',
  title,
  className,
}: {
  icon?: ReactNode
  phase?: PhaseIconPhase
  label: ReactNode
  meta?: ReactNode
  dot?: StatusTone
  active?: boolean
  href?: string
  onClick?: MouseEventHandler<HTMLElement>
  actions?: ReactNode
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onDoubleClick?: MouseEventHandler<HTMLDivElement>
  tone?: 'default' | 'quiet'
  title?: string
  className?: string
}) {
  const quiet = tone === 'quiet'
  const glyph = phase ? (
    <PhaseIcon phase={phase} />
  ) : icon ? (
    <span className={cx('inline-flex [&>svg]:size-4', active ? 'text-text' : 'text-icon group-hover/nav:text-text')}>
      {icon}
    </span>
  ) : null
  return (
    <div
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      className={cx(
        // `relative` holds the absolutely placed actions; the row is never
        // itself positioned by a caller (it lives in a flex column).
        'group/nav relative flex min-w-0 shrink-0 items-center rounded-md',
        'transition-colors duration-(--dur-1) ease-app',
        quiet ? 'h-7' : 'h-(--row-h)',
        active
          ? 'bg-surface-selected text-text'
          : quiet
            ? 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        className,
      )}
    >
      <RowControl
        href={href}
        onClick={onClick}
        current={active}
        title={title ?? (typeof label === 'string' ? label : undefined)}
        className={cx(
          'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pr-3 text-left text-inherit',
          // Quiet rows carry no glyph: the words start where a label does
          // after a 16px icon (10 + 16 + 8).
          quiet ? 'pl-8.5 text-xs' : 'pl-2.5 text-sm',
          active && 'font-medium',
        )}
      >
        {glyph && <Leading>{glyph}</Leading>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {dot && <StatusDot tone={dot} />}
        {meta !== undefined && meta !== null && (
          <span
            className={cx(
              'shrink-0 text-xs font-normal text-text-tertiary tabular-nums',
              actions ? 'group-focus-within/nav:opacity-0 group-hover/nav:opacity-0' : undefined,
            )}
          >
            {meta}
          </span>
        )}
      </RowControl>
      {actions && (
        <span
          className={cx(
            'absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5',
            'opacity-0 transition-opacity duration-(--dur-1) group-focus-within/nav:opacity-100 group-hover/nav:opacity-100',
            'has-[[aria-expanded=true]]:opacity-100',
          )}
        >
          {actions}
        </span>
      )}
    </div>
  )
}

/**
 * A 40px list row in the content panel: a leading glyph, a one-line title,
 * trailing meta — conversations, tickets, laps, runs, projects, notes.
 *
 * - `leading` — the glyph (a `PhaseIcon`, a `StatusDot`, an `Icon*`, a
 *   thumbnail); it sits in a 16px square in the `icon` colour.
 * - `title` — one line, truncated; `wrap` lets it wrap instead (a note is
 *   prose). `subtitle` — an inline second word run after it in
 *   `text-tertiary`. `description` — a second line beneath the title (12px
 *   `text-tertiary`, truncated): a repo path, a drive tag.
 * - `meta` — trailing timestamp, count or status word, `text-xs text-tertiary`.
 * - `onClick` / `href` — makes the row a button / link; without either it is
 *   static. `tooltip` is the hover title ("Open runcastle"); `label` replaces
 *   the row's text as its accessible name;
 *   `expanded` marks a row that opens something beneath it (`aria-expanded`).
 * - `control` — an interactive thing that lives *in* the row but not in its
 *   click target (a model picker): rendered beside the button, never nested
 *   in it. With a `control`, the `meta` follows it, outside the button too.
 * - `actions` — trailing controls revealed on hover / focus. By default they
 *   reserve their width; `actionsOverlay` floats them over the `meta` instead
 *   (which fades out while they show), so a row keeps its meta column tight.
 * - `active` — the current row (`surface-selected`).
 * - `index` — its position on first render: the first 8 rows rise in with a
 *   20ms stagger. Pass it only on the initial list, never on rows that arrive
 *   by polling (those can pass `animate` alone).
 * - `as` — the root element (`div`, or `li` inside a `ul`, or `article`).
 */
export function ListRow({
  leading,
  title,
  subtitle,
  description,
  wrap = false,
  meta,
  onClick,
  href,
  tooltip,
  label,
  expanded,
  control,
  actions,
  actionsOverlay = false,
  active = false,
  index,
  animate = false,
  as: Root = 'div',
  className,
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  description?: ReactNode
  wrap?: boolean
  meta?: ReactNode
  onClick?: MouseEventHandler<HTMLElement>
  href?: string
  tooltip?: string
  label?: string
  expanded?: boolean
  control?: ReactNode
  actions?: ReactNode
  actionsOverlay?: boolean
  active?: boolean
  index?: number
  animate?: boolean
  as?: 'div' | 'li' | 'article'
  className?: string
}) {
  const interactive = onClick !== undefined || href !== undefined
  const staggered = index !== undefined && index < 8
  const multiline = wrap || description !== undefined
  const hasMeta = meta !== undefined && meta !== null
  const overlay = actionsOverlay && !!actions
  const metaNode = hasMeta && (
    <span
      className={cx(
        'shrink-0 text-xs text-text-tertiary tabular-nums',
        wrap && 'mt-0.5 self-start',
        overlay && 'transition-opacity duration-(--dur-1) group-focus-within/row:opacity-0 group-hover/row:opacity-0',
      )}
    >
      {meta}
    </span>
  )
  const body = (
    <>
      {leading && (
        <span className={cx('inline-flex shrink-0', multiline && 'mt-0.5 self-start')}>
          <Leading>
            <span className="inline-flex text-icon [&>svg]:size-4">{leading}</span>
          </Leading>
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={wrap ? 'min-w-0 text-pretty wrap-anywhere' : 'min-w-0 truncate'}>
          {title}
          {subtitle && <span className="ml-2 text-text-tertiary">{subtitle}</span>}
        </span>
        {description !== undefined && (
          <span className="min-w-0 truncate text-xs text-text-tertiary">{description}</span>
        )}
      </span>
      {!control && metaNode}
    </>
  )
  const inner = cx(
    'flex min-h-10 min-w-0 flex-1 gap-3 rounded-md px-3 text-left text-sm text-text',
    wrap ? 'items-start' : 'items-center',
    multiline && 'py-2',
  )
  return (
    <Root
      data-list-row=""
      style={staggered ? ({ '--i': index } as CSSProperties) : undefined}
      className={cx(
        // `relative` anchors the overlaid actions.
        'group/row relative flex min-w-0 items-center rounded-md transition-colors duration-(--dur-1) ease-app',
        'list-none',
        active ? 'bg-surface-selected' : interactive && 'hover:bg-surface-hover',
        (staggered || animate) && 'animate-rise-in',
        staggered && '[animation-delay:calc(var(--i)*20ms)]',
        className,
      )}
    >
      {interactive ? (
        <RowControl
          href={href}
          onClick={onClick}
          current={active}
          title={tooltip}
          label={label}
          expanded={expanded}
          className={cx(inner, 'cursor-pointer')}
        >
          {body}
        </RowControl>
      ) : (
        <div className={inner}>{body}</div>
      )}
      {control && <span className="flex min-w-0 shrink items-center">{control}</span>}
      {control && hasMeta && <span className="flex shrink-0 items-center pr-3 pl-3">{metaNode}</span>}
      {actions && (
        <span
          className={cx(
            'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--dur-1)',
            'group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100',
            overlay
              ? cx('absolute right-2 rounded-md bg-inherit pl-1', wrap ? 'top-1.5' : 'top-1/2 -translate-y-1/2')
              : 'mr-2',
          )}
        >
          {actions}
        </span>
      )}
    </Root>
  )
}

/**
 * A column of `ListRow`s. `divided` draws a `border-subtle` rule between rows
 * (long lists) and squares their corners; without it rows are separated by
 * nothing but their own hover.
 */
export function List({
  divided = false,
  label,
  className,
  children,
}: {
  divided?: boolean
  /** Accessible name, when the list has no visible heading. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      aria-label={label}
      className={cx(
        'flex flex-col',
        divided &&
          '[&>[data-list-row]]:rounded-none [&>[data-list-row]]:border-b [&>[data-list-row]]:border-border-subtle [&>[data-list-row]:last-child]:border-b-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** One fact in a {@link PropertyList}. */
export interface PropertyItem {
  label: ReactNode
  value: ReactNode
  /** A quiet note after the value ("this build", "19h ago"). */
  sub?: ReactNode
  /** Leading glyph before the value: any element… */
  leading?: ReactNode
  /** …or a status dot in this tone… */
  tone?: StatusTone
  /** …or this phase's glyph. */
  phase?: PhaseIconPhase
  /** The value is code-shaped (branch, path, SHA): mono 12px, truncated. */
  mono?: boolean
}

/**
 * Key–value facts about the current object in two quiet columns: keys in
 * `text-tertiary`, values in `text` with an optional leading glyph and a
 * `text-tertiary` sub-note. What rows of outlined status pills become.
 */
export function PropertyList({ items, className }: { items: PropertyItem[]; className?: string }) {
  return (
    <dl className={cx('m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm', className)}>
      {items.map((it, i) => {
        const glyph = it.leading ?? (it.phase ? <PhaseIcon phase={it.phase} size={14} label="" /> : it.tone ? <StatusDot tone={it.tone} /> : null)
        return (
          <div key={i} className="contents">
            <dt className="flex min-h-6 items-center text-text-tertiary">{it.label}</dt>
            <dd className="m-0 flex min-h-6 min-w-0 items-center gap-2 text-text">
              {glyph && (
                <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon [&>svg]:size-3.5">
                  {glyph}
                </span>
              )}
              <span className={cx('min-w-0', it.mono ? 'truncate font-mono text-xs text-text-secondary' : 'font-medium')}>
                {it.value}
              </span>
              {it.sub && <span className="min-w-0 truncate text-text-tertiary">{it.sub}</span>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** One fact in a {@link MetaLine}. */
export interface MetaItem {
  /** The fact, in `text-tertiary`. */
  text?: ReactNode
  /** An emphasised lead (a count, a name), in `text-secondary` medium. */
  strong?: ReactNode
  /** A leading status dot… */
  tone?: StatusTone
  /** …or a leading glyph (14px)… */
  icon?: ReactNode
  /** …or a phase glyph. */
  phase?: PhaseIconPhase
  /** Code-shaped text (a branch): mono. */
  mono?: boolean
  title?: string
}

/**
 * One line of small inline facts separated by space — branch, age, counts —
 * under a page title or in a row. Keep it to 2–4 facts; more belongs in a
 * `PropertyList`. Falsy entries are skipped, so conditional facts can be
 * written inline (`cond && { text: … }`).
 */
export function MetaLine({
  items,
  className,
}: {
  items: Array<MetaItem | false | null | undefined>
  className?: string
}) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-tertiary', className)}>
      {items.map((it, i) => {
        if (!it) return null
        const glyph = it.phase ? (
          <PhaseIcon phase={it.phase} size={14} label="" />
        ) : it.tone ? (
          <StatusDot tone={it.tone} />
        ) : it.icon ? (
          <span className={cx('inline-flex [&>svg]:size-3.5', TONE_TEXT.neutral)}>{it.icon}</span>
        ) : null
        return (
          <span key={i} title={it.title} className="inline-flex min-w-0 items-center gap-1.5">
            {glyph}
            {it.strong !== undefined && <span className="font-medium text-text-secondary">{it.strong}</span>}
            {it.text !== undefined && <span className={cx('min-w-0 truncate', it.mono && 'font-mono')}>{it.text}</span>}
          </span>
        )
      })}
    </div>
  )
}
