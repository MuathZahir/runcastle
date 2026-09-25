import { useState } from 'react'
import type { RefObject } from 'react'
import { IconTrash } from '../icons'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Field, TextField } from '../ui'

/**
 * Destructive confirmation for `feature.delete` (decision #8). Delete is
 * permanent and irreversible — it tears down processes, the worktree, branches,
 * and every DB row — so the confirm stays disabled until the user types the
 * feature slug exactly, echoing the title so the wrong feature is not nuked by
 * a reflex click. Escape and a backdrop click cancel.
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
    <Dialog open onClose={onCancel} returnFocusRef={returnFocusRef} labelledBy="delete-feature-title" size="sm">
      <DialogHeader id="delete-feature-title" title="Delete feature" onClose={onCancel} />
      <DialogBody className="flex flex-col gap-5">
        <p className="m-0 text-sm text-pretty text-text-secondary">
          Permanently delete <strong className="font-medium text-text">{title}</strong>? Its worktree,
          branches, running agent and all runcastle data go with it; committed docs stay in git history.{' '}
          <strong className="font-medium text-text">This cannot be undone.</strong>
        </p>
        <Field
          label={
            <>
              Type <code className="font-mono text-xs text-text">{slug}</code> to confirm
            </>
          }
        >
          <TextField
            mono
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder={slug}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" icon={<IconTrash />} onClick={onConfirm} disabled={!armed || busy}>
          {busy ? 'Deleting…' : 'Delete feature'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
