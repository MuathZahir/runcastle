import type { ReactNode } from 'react'
import type { ActionKind, NextAction } from '../../lib/feature-ui'
import { Button, SplitButton, type ButtonVariant } from '../../ui'
import { ACTION_ICON } from './NextStepBar'

/**
 * The feature header's one action button (design-mode decision 12) — the
 * status's primary, or Merge & ship (see `headerActions`). Small, to sit in
 * the 44px row; a disabled one says why in its title, since the row has no
 * room for a caption. Merge is `secondary` (its confirmation is the weighty
 * step); every other action is the row's primary.
 */
export function HeaderAction({
  action,
  busy,
  onAction,
  split,
}: {
  action: NextAction
  busy: boolean
  onAction: (kind: ActionKind) => void
  /** Test drive's scenarios, behind a caret when this is Test drive. */
  split?: { kind: ActionKind; label: string; menu: ReactNode; menuLabel: string }
}) {
  const variant: ButtonVariant = action.danger ? 'danger' : action.kind === 'merge' ? 'secondary' : 'primary'
  const props = {
    size: 'sm' as const,
    variant,
    icon: ACTION_ICON[action.kind],
    disabled: busy || !!action.disabled,
    title: action.disabled ?? action.hint,
    onClick: () => onAction(action.kind),
  }
  return split?.kind === action.kind ? (
    <SplitButton {...props} menu={split.menu} menuLabel={split.menuLabel}>
      {split.label}
    </SplitButton>
  ) : (
    <Button {...props}>{action.label}</Button>
  )
}
