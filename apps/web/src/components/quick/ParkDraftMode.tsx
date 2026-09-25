import { IconBranch, IconDoc } from '../../icons'
import { Button, DialogBody, DialogFooter, DialogHeader, Field, TextArea, TextField } from '../../ui'

/**
 * The Draft form's content: a title, an optional one-liner, optional Notes
 * that land as the draft's brief — and one primary, Park draft. The footer
 * previews the branch Start will cut, in mono, and cuts nothing now.
 */
export function ParkDraftMode({
  title,
  slug,
  oneLiner,
  notes,
  duplicate,
  busy,
  ready,
  onTitleChange,
  onOneLinerChange,
  onNotesChange,
  onSubmit,
  onCancel,
}: {
  title: string
  slug: string
  oneLiner: string
  notes: string
  duplicate: string | null
  busy: boolean
  ready: boolean
  onTitleChange: (value: string) => void
  onOneLinerChange: (value: string) => void
  onNotesChange: (value: string) => void
  onSubmit: (brief?: string) => void
  onCancel: () => void
}) {
  const submit = () => onSubmit(notes.trim() || undefined)
  return (
    <>
      <DialogHeader
        id="park-draft-title"
        title="Park it for later"
        description="Write it down now, work it out later. Nothing is cut until you Start it."
        onClose={onCancel}
      />
      <DialogBody className="flex flex-col gap-4 pt-1">
        <Field label="Title" error={duplicate}>
          <TextField
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="e.g. Slack alerts on failed runs"
            autoFocus
            invalid={!!duplicate}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        </Field>
        <Field label="One-liner (optional)">
          <TextField
            value={oneLiner}
            onChange={(event) => onOneLinerChange(event.target.value)}
            placeholder="What and why, in a sentence"
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        </Field>
        <Field label="Notes (optional — becomes the brief)">
          <TextArea
            rows={5}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Anything Start should know"
          />
        </Field>
      </DialogBody>
      <DialogFooter
        className="mt-2 border-t border-border-subtle pt-4"
        start={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <IconBranch size={14} className="shrink-0 text-icon" />
            <span className="truncate font-mono">feature/{slug || '…'} · draft</span>
          </span>
        }
      >
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" icon={<IconDoc />} onClick={submit} disabled={!ready || busy}>
          {busy ? 'Parking…' : 'Park draft'}
        </Button>
      </DialogFooter>
    </>
  )
}
