import type { ReactNode } from 'react'
import { Dialog } from '../ui'

/**
 * The shell around the Draft form — the app's last creation form, now that its
 * two siblings (New feature, Quick change) have become conversations.
 *
 * It exists because those two disagreed about what dismissal means (findings
 * F25.2): Escape threw away everything typed without a word, while clicking
 * outside the card did nothing at all — so the same intent, expressed two ways,
 * had two different outcomes and one of them was destructive. Here there is one
 * dismissal, reached from Escape, the backdrop and the form's own Cancel, and it
 * never destroys prose silently: with anything typed it asks first.
 *
 * All of that now lives in {@link Dialog}, which the other four overlays share.
 * This one is `inline`: it fills the content panel rather than the viewport,
 * and the sidebar beside it stays live — portalling it would blank the page
 * behind a backdrop and cover navigation that still works. The panel is the
 * dialog's own face (`surface-raised`, `rounded-lg`, `shadow-dialog`), rising
 * in over the empty panel; the content lays itself out with the Dialog parts.
 *
 * `children` is a render prop so the form's Cancel button goes through the same
 * guard as everything else rather than calling `onDismiss` behind its back.
 */
export function FormOverlay({
  dirty,
  onDismiss,
  children,
}: {
  /** Something has been typed that dismissing would throw away. */
  dirty: boolean
  onDismiss: () => void
  children: (dismiss: () => void) => ReactNode
}) {
  return (
    <Dialog
      open
      onClose={onDismiss}
      dirty={dirty}
      inline
      labelledBy="park-draft-title"
      backdropClassName="min-h-0 overflow-y-auto bg-surface"
      className="max-w-[560px]"
    >
      {children}
    </Dialog>
  )
}
