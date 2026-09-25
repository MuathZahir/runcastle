import type { ComponentPropsWithRef, HTMLAttributeAnchorTarget, MouseEventHandler, ReactNode, Ref } from 'react'
import { cx } from './floating'
import { Kbd } from './kbd'
import { Tooltip } from './tooltip'

/**
 * Buttons (DESIGN.md §Components). Styled with utilities on the theme tokens;
 * variants are lookup maps; `cx()` is the whole variant machinery.
 *
 * Focus rings are deliberately absent from these class lists: `styles.css`
 * paints the `:focus-visible` outline globally and unlayered.
 *
 * **The className rule** (every primitive, STYLE.md §Primitives): a
 * primitive's root never states `position`, `margin`, `z-index` or its outer
 * width — those *place* it, and a caller's `className` owns them (`absolute
 * top-3 right-3`, `-ml-2`, `self-start` all just work). What a primitive *is*
 * — height, padding, colour, border — comes from its props (`size`,
 * `variant`); a caller never restyles it through `className` or `!`. When a
 * look is missing, add a variant here.
 */

/**
 * `primary` — the inverted neutral; **at most one per view**, for the thing the
 * page is for. `secondary` — a hairline button for the other real actions.
 * `ghost` — toolbar and row actions (most buttons). `danger` — only inside a
 * destructive confirmation. `danger-ghost` — a destructive action sitting in a
 * row of ghosts (Stop ticket, Cancel run, End session): no border or fill at
 * rest, the word in `danger`, the `danger-subtle` ground on hover.
 *
 * Deprecated spellings, still accepted so callers compile: `solid` → primary,
 * `accent` → secondary.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'solid' | 'accent'

/** `sm` 24 (inside rows and toolbars) · `md` 28 (default) · `lg` 32 (a page header's primary). `xs` is a deprecated alias of `sm`. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xs'

type CanonicalVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type CanonicalSize = 'sm' | 'md' | 'lg'

const VARIANT_ALIAS: Record<ButtonVariant, CanonicalVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'danger',
  'danger-ghost': 'danger-ghost',
  solid: 'primary',
  accent: 'secondary',
}

const SIZE_ALIAS: Record<ButtonSize, CanonicalSize> = { sm: 'sm', md: 'md', lg: 'lg', xs: 'sm' }

/** No `position`, margin or z-index: those are the caller's (the className rule above). */
const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium select-none ' +
  'transition-[color,background-color,border-color,transform] duration-(--dur-1) ease-app ' +
  'enabled:active:translate-y-px disabled:cursor-not-allowed'

const BUTTON_SIZE: Record<CanonicalSize, string> = {
  sm: 'h-(--control-sm) px-2 text-xs',
  md: 'h-(--control-h) px-2.5 text-sm',
  lg: 'h-(--control-lg) px-3.5 text-sm',
}

/**
 * Every variant states its own resting background, `bg-transparent` included:
 * there is no preflight, and a button that names none keeps the user agent's.
 */
const BUTTON_VARIANT: Record<CanonicalVariant, string> = {
  primary:
    'border-transparent bg-primary text-on-primary enabled:hover:bg-primary-hover ' +
    'disabled:bg-surface-selected disabled:text-text-disabled',
  secondary:
    'border-border bg-transparent text-text enabled:hover:border-border-strong enabled:hover:bg-surface-hover ' +
    'disabled:border-border-subtle disabled:text-text-disabled',
  ghost:
    'border-transparent bg-transparent text-text-secondary enabled:hover:bg-surface-hover enabled:hover:text-text ' +
    'aria-pressed:bg-surface-selected aria-pressed:text-text aria-expanded:bg-surface-selected aria-expanded:text-text ' +
    'disabled:text-text-disabled',
  danger:
    'border-border bg-transparent text-danger enabled:hover:border-danger-subtle enabled:hover:bg-danger-subtle ' +
    'disabled:border-border-subtle disabled:text-text-disabled',
  'danger-ghost':
    'border-transparent bg-transparent text-danger enabled:hover:bg-danger-subtle ' +
    'aria-expanded:bg-danger-subtle disabled:text-text-disabled',
}

/** Icons sit at 14px in a small button and 16px otherwise, in the label's colour. */
const ICON_BOX: Record<CanonicalSize, string> = {
  sm: 'inline-flex shrink-0 opacity-85 [&>svg]:size-3.5',
  md: 'inline-flex shrink-0 opacity-85 [&>svg]:size-4',
  lg: 'inline-flex shrink-0 opacity-85 [&>svg]:size-4',
}

/** A Kbd on the inverted primary: ink colour, no outline. */
const PRIMARY_KBD = 'border-transparent text-on-primary opacity-60'

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (an `Icon*` element). Replaced by a spinner while `loading`. */
  icon?: ReactNode
  /** A shortcut hint after the label, e.g. "C" or "Ctrl Enter". */
  kbd?: string
  /** In flight: shows a spinner, keeps the button's width, and disables it. */
  loading?: boolean
}

/**
 * The app's button. Forwards every `<button>` attribute (and `ref`, so it can
 * be a Radix `asChild` trigger); a `className` you pass is appended.
 *
 * Props: `variant` (default `secondary`), `size` (default `md`), `icon`,
 * `kbd`, `loading`. Press nudges it down 1px; colour changes take `--dur-1`.
 *
 * `type` defaults to `button` rather than HTML's `submit`, so a control runs
 * its `onClick` and nothing else; pass `type="submit"` where a submit is meant.
 * An icon-only button is an {@link IconButton}, which carries the label.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  icon,
  kbd,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const v = VARIANT_ALIAS[variant]
  const s = SIZE_ALIAS[size]
  // No icon to swap: the spinner is stacked over a label made invisible (one
  // grid cell, no `relative`), so the button keeps exactly the width it had.
  const overlay = loading && !icon
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={v}
      className={cx(BUTTON_BASE, BUTTON_SIZE[s], BUTTON_VARIANT[v], className)}
      {...rest}
    >
      {icon !== undefined &&
        (loading ? <Spinner size={s === 'sm' ? 'sm' : 'md'} tone="current" /> : <span className={ICON_BOX[s]}>{icon}</span>)}
      {overlay ? (
        <span className="inline-grid place-items-center">
          <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-1.5">{children}</span>
          <span className="col-start-1 row-start-1 inline-flex">
            <Spinner size={s === 'sm' ? 'sm' : 'md'} tone="current" />
          </span>
        </span>
      ) : (
        children
      )}
      {kbd && <Kbd className={cx('ml-0.5', v === 'primary' && PRIMARY_KBD)}>{kbd}</Kbd>}
    </button>
  )
}

/** Ghost, but at rest the glyph wears the `icon` colour, not `text-secondary`. */
const ICON_GHOST =
  'border-transparent bg-transparent text-icon enabled:hover:bg-surface-hover enabled:hover:text-text ' +
  'aria-pressed:bg-surface-selected aria-pressed:text-text aria-expanded:bg-surface-selected aria-expanded:text-text ' +
  'disabled:text-text-disabled'

/**
 * An icon button that deletes or removes (a row's trash can): quiet at rest
 * like any row chrome, `danger` only under the pointer — a column of red
 * glyphs would shout.
 */
const ICON_DANGER_GHOST =
  'border-transparent bg-transparent text-icon enabled:hover:bg-danger-subtle enabled:hover:text-danger ' +
  'aria-expanded:bg-danger-subtle aria-expanded:text-danger disabled:text-text-disabled'

const ICON_BUTTON_SIZE: Record<CanonicalSize, string> = {
  sm: 'size-(--control-sm) [&>svg]:size-3.5',
  md: 'size-(--control-h) [&>svg]:size-4',
  lg: 'size-(--control-lg) [&>svg]:size-4',
}

export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  /** Required: the tooltip text and the accessible name. A verb phrase: "Open settings". */
  label: string
  /** The one icon (an `Icon*` element). `children` is accepted as an alias. */
  icon?: ReactNode
  children?: ReactNode
  /** `sm` 24 inside rows · `md` 28 in bars (default) · `lg` 32. `xs` = `sm`. */
  size?: ButtonSize
  /**
   * Default `ghost` (no border or fill at rest). `danger-ghost` stays quiet at
   * rest and turns `danger` on hover — a row's Delete.
   */
  variant?: ButtonVariant
  /** A toggle that is on (the open aside, the pressed filter): `surface-selected`. Sets `aria-pressed`. */
  active?: boolean
  /** Shortcut shown in the tooltip, e.g. "Ctrl K". */
  kbd?: string
  /** Which side the tooltip opens on (default `top`). */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  /**
   * Render as a link (`<a>`) to this URL — "Open app ↗". `target` / `rel` go
   * with it; a `_blank` target gets `rel="noreferrer noopener"` unless you say
   * otherwise. The button-only attributes are ignored.
   */
  href?: string
  target?: HTMLAttributeAnchorTarget
  rel?: string
  /**
   * A small count in the top-right corner (open notes, unread). Nothing at 0,
   * `undefined` or `null`; `99+` past 99. Neutral, not a colour — the count is
   * the information. Also read out after the label.
   */
  badge?: number | null
}

/** The corner count. `text-[10px]` is the one sub-scale size: it is a glyph, not text. */
const BADGE =
  'pointer-events-none absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full ' +
  'bg-text-tertiary px-1 text-[10px] leading-none font-semibold text-surface tabular-nums animate-pop-in'

/**
 * A square button holding one icon — the default for chrome (search,
 * settings, panel toggles, the row's "…"). Always named: `label` becomes its
 * `aria-label` and its tooltip. Forwards `ref` and every button attribute, so
 * it can be a `DropdownMenuTrigger asChild`. With `href` it is a link that
 * looks the same; with `badge` it carries a small count.
 */
export function IconButton({
  label,
  icon,
  children,
  size = 'md',
  variant = 'ghost',
  active,
  kbd,
  tooltipSide,
  type = 'button',
  href,
  target,
  rel,
  badge,
  className,
  ...rest
}: IconButtonProps) {
  const v = VARIANT_ALIAS[variant]
  const s = SIZE_ALIAS[size]
  const count = typeof badge === 'number' && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null
  const classes = cx(
    BUTTON_BASE,
    'p-0',
    // The one position a primitive states, and only while the badge needs it.
    count && 'relative',
    ICON_BUTTON_SIZE[s],
    v === 'ghost' ? ICON_GHOST : v === 'danger-ghost' ? ICON_DANGER_GHOST : BUTTON_VARIANT[v],
    className,
  )
  const name = count ? `${label} (${count})` : label
  const glyph = (
    <>
      {icon ?? children}
      {count && (
        <span aria-hidden="true" className={BADGE}>
          {count}
        </span>
      )}
    </>
  )
  if (href !== undefined) {
    return (
      <Tooltip label={label} kbd={kbd} side={tooltipSide}>
        <a
          href={href}
          target={target}
          rel={rel ?? (target === '_blank' ? 'noreferrer noopener' : undefined)}
          aria-label={name}
          className={cx(classes, 'no-underline hover:bg-surface-hover hover:text-text')}
          ref={rest.ref as unknown as Ref<HTMLAnchorElement>}
          onClick={rest.onClick as unknown as MouseEventHandler<HTMLAnchorElement>}
        >
          {glyph}
        </a>
      </Tooltip>
    )
  }
  return (
    <Tooltip label={label} kbd={kbd} side={tooltipSide}>
      <button type={type} aria-label={name} aria-pressed={active} className={classes} {...rest}>
        {glyph}
      </button>
    </Tooltip>
  )
}

const SPINNER_SIZE: Record<'sm' | 'md', string> = {
  sm: 'size-3',
  md: 'size-3.5',
}

/**
 * `work` and `accent` are the deprecated tones and both render the quiet
 * default now; `current` takes the colour of the text around it (inside a
 * button).
 */
const SPINNER_TONE: Record<'work' | 'accent' | 'quiet' | 'current', string> = {
  quiet: 'border-text-tertiary',
  work: 'border-text-tertiary',
  accent: 'border-text-tertiary',
  current: 'border-current',
}

/**
 * The quiet ring that says something is in flight — 1.5px, `text-tertiary`.
 * Only ever beside a word that says the state ("Burning", "Starting…"), so it
 * is `aria-hidden` rather than labelled. `size`: `md` 14 (default) · `sm` 12.
 */
export function Spinner({
  size = 'md',
  tone = 'quiet',
  className,
}: {
  size?: 'sm' | 'md'
  tone?: 'quiet' | 'current' | 'work' | 'accent'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-t-transparent',
        SPINNER_SIZE[size],
        SPINNER_TONE[tone],
        className,
      )}
    />
  )
}

/**
 * The reset a plain `<button>` needs when it is not a {@link Button} — a
 * breadcrumb, a rail row, a close ✕. There is no preflight (apps/web/STYLE.md),
 * so a bare button would keep the user agent's chrome. (`theme.css` now resets
 * raw buttons in its base layer too; this stays for the callers that spell it.)
 */
export const BARE_BUTTON = 'border-0 bg-transparent'

/**
 * The one link look, for an `<a>` or a `<button>` that reads as a link inside
 * text — "Edit in settings", "View", a feature's name in a note, a link in
 * Markdown: `accent-text`, no underline at rest, an underline on hover. Quiet
 * enough to sit in a sentence; the colour says it goes somewhere.
 */
export const LINK =
  'cursor-pointer text-accent-text no-underline decoration-accent-text/50 underline-offset-2 ' +
  'transition-colors duration-(--dur-1) ease-app hover:underline hover:decoration-accent-text'
