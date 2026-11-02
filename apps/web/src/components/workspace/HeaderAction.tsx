import type { ReactNode } from 'react'
import type { ActionKind, NextAction } from '../../lib/feature-ui'
import { Button, SplitButton, type ButtonVariant } from '../../ui'
import { ACTION_ICON } from './NextStepBar'

/**
 * One of the feature header's buttons (you-always-know-what-s-waiting decision
 * 6) — the status's primary, or the quiet Merge & ship beside it (see
 * `headerActions`). Small, to sit in the 44px row; a disabled one says why in
 * its title, since the row has no room for a caption. A danger action (Stop)
 * stays danger; `quiet` is the secondary look Merge wears beside the primary.
 */
export function HeaderAction({
  action,
  busy,
  onAction,
  split,
  quiet = false,
}: {
  action: NextAction
  busy: boolean
  onAction: (kind: ActionKind) => void
  /** Test drive's scenarios, behind a caret when this is Test drive. */
  split?: { kind: ActionKind; label: string; picker: ReactNode; menuLabel: string }
  /** The second button of the row: Merge & ship beside the need's own. */
  quiet?: boolean
}) {
  const variant: ButtonVariant = action.danger ? 'danger' : quiet ? 'secondary' : 'primary'
  const props = {
    size: 'sm' as const,
    variant,
    icon: ACTION_ICON[action.kind],
    disabled: busy || !!action.disabled,
    title: action.disabled ?? action.hint,
    onClick: () => onAction(action.kind),
  }
  return split?.kind === action.kind ? (
    <SplitButton {...props} picker={split.picker} menuLabel={split.menuLabel}>
      {split.label}
    </SplitButton>
  ) : (
    <Button {...props}>{action.label}</Button>
  )
}
