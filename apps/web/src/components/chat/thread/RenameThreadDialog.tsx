import { useState } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, TextField } from '../../../ui'

/** Rename a thread, from its row's menu in the sidebar: Enter saves, Escape cancels. */
export function RenameThreadDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title)
  const next = value.trim()
  const save = () => {
    if (next && next !== title) onSave(next)
    else onClose()
  }
  return (
    <Dialog open onClose={onClose} size="sm" labelledBy="rename-thread-title">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogHeader id="rename-thread-title" title="Rename thread" />
        <DialogBody>
          <TextField aria-label="Thread name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} autoFocus />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!next}>
            Rename
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
