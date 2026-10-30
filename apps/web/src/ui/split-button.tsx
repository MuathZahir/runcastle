import type { ReactNode } from 'react'
import { IconChevronDown } from '../icons'
import { Button, type ButtonSize, type ButtonVariant } from './button'
import { Combobox, ComboboxTrigger } from './combobox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu'
import { cx } from './floating'

/**
 * One action with its default, plus the choices behind an attached caret — the
 * Test drive that starts on the feature's own scenario in one click, and lists
 * the others one click further (drive-scenarios decision 7).
 *
 * The main half is a {@link Button}; the caret opens a {@link DropdownMenu}
 * whose items the caller passes as `menu` (`DropdownMenuItem`,
 * `DropdownMenuLabel`, `DropdownMenuSeparator`). The two halves share
 * `variant`, `size` and `disabled`; `loading` spins the main half and disables
 * both, so nothing can start twice. A 1px seam separates them, so neither half
 * states a border of its own beside the other.
 *
 * When the choices are values rather than actions — a scenario to start on —
 * pass `picker` instead of `menu`: a `ComboboxContent`, which the caret opens as
 * a searchable list (test-drive-looks-the-part decision 1).
 */
export function SplitButton({
  variant = 'secondary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  title,
  onClick,
  menu,
  picker,
  menuLabel,
  className,
  children,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  /** The main half's leading icon. */
  icon?: ReactNode
  disabled?: boolean
  loading?: boolean
  /** The main half's title — a disabled reason, or a hint. */
  title?: string
  /** The default action. */
  onClick: () => void
  /** The menu's items. */
  menu?: ReactNode
  /** Or a `ComboboxContent`, for choices that are values (a scenario): the caret opens it. */
  picker?: ReactNode
  /** The caret's accessible name, e.g. "Choose a scenario". */
  menuLabel: string
  /** Placement only (the className rule, STYLE.md). */
  className?: string
  /** The main half's label. */
  children: ReactNode
}) {
  const caret = (
    <Button
      variant={variant}
      size={size}
      attached="end"
      aria-label={menuLabel}
      title={menuLabel}
      disabled={disabled || loading}
      icon={<IconChevronDown />}
    />
  )
  return (
    <span className={cx('inline-flex shrink-0 items-stretch gap-px', className)}>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        attached="start"
        loading={loading}
        disabled={disabled}
        title={title}
        onClick={onClick}
      >
        {children}
      </Button>
      {picker ? (
        <Combobox>
          <ComboboxTrigger asChild>{caret}</ComboboxTrigger>
          {picker}
        </Combobox>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{caret}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )
}
