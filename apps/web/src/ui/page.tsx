import type { MouseEventHandler, ReactNode } from 'react'
import { IconChevronRight, IconX } from '../icons'
import { IconButton } from './button'
import { cx } from './floating'
import { MetaLine } from './list'
import type { MetaItem } from './list'

/**
 * The frame pieces every surface shares (DESIGN.md §Frame, §Page anatomy), so
 * each screen lays out identically inside the content panel:
 *
 *   PageTopbar (44px: crumbs · tabs · actions)
 *   Page (scrolling, centred column 760/1040, 48/32/64 padding, rises in)
 *     PageHeader (title-lg + MetaLine + slot)
 *     PageSection … (title + content, separated by air)
 *   Aside (the one right-hand panel, slides in)
 */

/** One step of a breadcrumb. The last item is the current page. */
export interface Crumb {
  label: ReactNode
  /** Leading 14px glyph (a PhaseIcon, an Icon*). */
  icon?: ReactNode
  onClick?: MouseEventHandler<HTMLElement>
  href?: string
  /** Code-shaped (a branch): mono. */
  mono?: boolean
}

/**
 * The breadcrumb in a topbar: parents in `text-tertiary` (clickable when they
 * have `onClick`/`href`), the current item in `text` medium, separated by a
 * quiet chevron. Truncates the current item first.
 */
export function Crumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx('flex min-w-0 items-center', className)}>
      <ol className="m-0 flex min-w-0 list-none items-center gap-1 p-0 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1
          const content = (
            <>
              {c.icon && <span className="inline-flex shrink-0 text-icon [&>svg]:size-3.5">{c.icon}</span>}
              <span className={cx('truncate', c.mono && 'font-mono text-xs')}>{c.label}</span>
            </>
          )
          const itemClass = cx(
            'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5',
            last ? 'font-medium text-text' : 'shrink-0 text-text-tertiary',
          )
          return (
            <li key={i} className={cx('flex min-w-0 items-center gap-1', !last && 'shrink-0')}>
              {last ? (
                <span aria-current="page" className={itemClass}>
                  {content}
                </span>
              ) : c.href !== undefined ? (
                <a href={c.href} onClick={c.onClick} className={cx(itemClass, 'no-underline hover:text-text')}>
                  {content}
                </a>
              ) : c.onClick ? (
                <button type="button" onClick={c.onClick} className={cx(itemClass, 'cursor-pointer hover:text-text')}>
                  {content}
                </button>
              ) : (
                <span className={itemClass}>{content}</span>
              )}
              {!last && <IconChevronRight size={12} className="shrink-0 text-text-disabled" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * The content panel's 44px top bar (`border-b border-subtle`). Left: `crumbs`
 * (or any `leading` node). Right: view `tabs`, then `actions` (secondary
 * buttons, then IconButtons — more, aside toggle).
 */
export function PageTopbar({
  leading,
  crumbs,
  tabs,
  actions,
  className,
}: {
  leading?: ReactNode
  crumbs?: Crumb[]
  tabs?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cx(
        'flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-border-subtle pr-3 pl-4',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        {crumbs && <Crumbs items={crumbs} />}
      </div>
      {tabs && <div className="flex shrink-0 items-center">{tabs}</div>}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}

const PAGE_WIDTH = {
  default: 'max-w-(--content-max)',
  wide: 'max-w-(--content-wide)',
} as const

/**
 * The scrolling page column inside the content panel: centred, 760px
 * (`default`, documents) or 1040px (`wide`, data-heavy views), padded 48 top /
 * 32 sides / 64 bottom. It rises in (240ms) once per `routeKey` — pass the
 * route or the object's id, never something that changes on refetch.
 * `className` lands on the inner column.
 */
export function Page({
  width = 'default',
  routeKey,
  className,
  children,
}: {
  width?: 'default' | 'wide'
  routeKey?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div key={routeKey} className={cx('mx-auto w-full px-8 pt-12 pb-16 animate-rise-in', PAGE_WIDTH[width], className)}>
        {children}
      </div>
    </div>
  )
}

/**
 * The top of a page: the `title` (22/28 semibold, once per page), a
 * `MetaLine` of 2–4 facts (`meta`: items, or any node), optional `actions` on
 * the title's line, and `children` beneath (the stepper, the next step).
 */
export function PageHeader({
  title,
  meta,
  actions,
  className,
  children,
}: {
  title: ReactNode
  meta?: Array<MetaItem | false | null | undefined> | ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <header className={cx('flex flex-col', className)}>
      <div className="flex items-start gap-4">
        <h1 className="m-0 min-w-0 flex-1 text-xl font-semibold text-pretty text-text">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {meta !== undefined && meta !== null && (
        <div className="mt-2">{Array.isArray(meta) ? <MetaLine items={meta} /> : meta}</div>
      )}
      {children && <div className="mt-5">{children}</div>}
    </header>
  )
}

/**
 * A body section: an optional `title` (16/24 semibold) with one trailing
 * `action`, then its content. Sections are separated by 40px of air — not by
 * cards or rules.
 */
export function PageSection({
  title,
  action,
  id,
  className,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  id?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section id={id} className={cx('mt-10 first:mt-0', className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-7 items-center gap-3">
          {title && <h2 className="m-0 min-w-0 flex-1 text-lg font-semibold text-text">{title}</h2>}
          {action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * The one right-hand panel (chat, details, notes) inside the content panel:
 * a 44px header with the `title`, optional `actions` and a close button, then
 * a scrolling body. Slides in from the right. Only ever one open at a time —
 * opening another replaces it. Width `--aside-w`.
 *
 * Lay it out with {@link AsideLayout}, which puts it beside the page and floats
 * it over the page when the panel is too narrow to share.
 *
 * `label` names the region when `title` is not a plain string (a tab set, a
 * title with a status dot); a string `title` names it by itself.
 */
export function Aside({
  title,
  label,
  onClose,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode
  label?: string
  onClose: () => void
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <aside
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cx(
        'flex h-full w-(--aside-w) min-w-0 shrink-0 flex-col border-l border-border bg-surface animate-slide-in-right',
        className,
      )}
    >
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-4">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-text">{title}</div>
        {actions}
        <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} />
      </div>
      <div className={cx('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
    </aside>
  )
}

/**
 * The row a page and its one {@link Aside} share. Without an `aside` it
 * renders `children` and nothing of its own — not a wrapper, not a stub, not a
 * collapsed rail — so a page with the aside away is exactly the markup it would
 * have without one.
 *
 * With one, the page gets its own column (`min-w-0`, so a wide ledger or a
 * long branch never pushes the aside off the edge) and the aside sits beside
 * it. In a narrow panel — under 56rem, a 1024px window with the sidebar open —
 * sharing would leave the page a sliver, so the aside **floats over** the
 * page's right edge instead, as a raised layer (`shadow-dialog`). A container
 * query, so it answers to the panel's width, not the window's.
 *
 * `className` lands on the page column (a `flex-col` by default).
 */
export function AsideLayout({
  aside,
  className,
  children,
}: {
  /** The aside, or a falsy value when none is open. */
  aside: ReactNode
  className?: string
  children: ReactNode
}) {
  if (aside === null || aside === undefined || aside === false) return <>{children}</>
  return (
    <div className="@container relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', className)}>{children}</div>
      <div className="flex h-full shrink-0 @max-4xl:absolute @max-4xl:inset-y-0 @max-4xl:right-0 @max-4xl:z-20 @max-4xl:shadow-dialog">
        {aside}
      </div>
    </div>
  )
}
