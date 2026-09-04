import { useState } from 'react'
import type { RefObject } from 'react'
import { Button, Dialog, Field } from '../ui'

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
  returnFocusRef,
}: {
  title: string
  slug: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const [typed, setTyped] = useState('')
  const armed = typed.trim() === slug

  return (
    <Dialog
      open
      onClose={onCancel}
      returnFocusRef={returnFocusRef}
      label={`Delete feature ${slug}`}
      size="sm"
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2 text-base leading-relaxed text-text-2">
          <p className="m-0">
            Permanently delete <strong className="font-semibold text-text">{title}</strong>? Its
            worktree, branches, running agent and all runcastle data go with it; committed docs
            stay in git history.
          </p>
          <strong className="font-semibold text-text">This cannot be undone.</strong>
        </div>
        <Field
          label={
            <>
              Type{' '}
              <code className="rounded-sm bg-panel-inset px-1.5 py-0.5 font-mono text-text">
                {slug}
              </code>{' '}
              to confirm
            </>
          }
        >
          <input
            className="h-(--control-h) rounded-md border border-hairline-strong bg-panel-inset px-3 font-mono text-base text-text outline-none placeholder:text-text-4 focus:border-danger"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder={slug}
          />
        </Field>
        <div className="flex justify-end gap-2">
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
