import { useState } from 'react'
import { Button, Dialog } from '../ui'

/**
 * Destructive confirmation for `feature.delete` (decision #8). Delete is
 * permanent and irreversible — it tears down processes, the worktree, branches,
 * and every DB row — so the primary action stays disabled until the user types
 * the feature slug exactly, echoing the title so the wrong feature is not nuked
 * by a reflex click. Peek-overlay styling matches SettingsOverlay / DocPeek;
 * Escape and a backdrop click cancel.
 */
export function DeleteFeatureDialog({
  title,
  slug,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  slug: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const armed = typed.trim() === slug

  return (
    <Dialog
      open
      onClose={onCancel}
      label={`Delete feature ${slug}`}
      backdropClassName="peek-backdrop"
      className="peek delete-dialog"
    >
      <div className="peek-head">
        <span className="delete-dialog-title">Delete feature</span>
        <button className="peek-close" onClick={onCancel} aria-label="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="peek-body delete-dialog-body">
        <p className="delete-dialog-lead">
          Permanently delete <strong>{title}</strong>? This stops any running agent,
          removes its worktree and branches, and erases all of its runcastle data.
          Committed docs stay in git history. <strong>This cannot be undone.</strong>
        </p>
        <label className="delete-dialog-field">
          <span>
            Type <code className="mono">{slug}</code> to confirm
          </span>
          <input
            className="settings-input mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder={slug}
          />
        </label>
        <div className="delete-dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!armed || busy}>
            {busy ? 'Deleting…' : 'Delete feature'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
