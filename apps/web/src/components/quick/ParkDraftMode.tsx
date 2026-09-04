import { Button, Field } from '../../ui'

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
  const input = 'h-(--control-h) rounded-md border border-hairline-strong bg-panel-inset px-3 text-base text-text outline-none focus:border-accent'
  const submit = () => onSubmit(notes.trim() || undefined)
  return (
    <>
      <div className="mt-2 flex flex-col gap-2">
        <h2 className="m-0 text-xl font-semibold text-text">Park it for later</h2>
        <p className="m-0 text-base text-text-2">A row and a title. Nothing is cut until you Start it.</p>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <Field label="Title" error={duplicate}>
          <input className={input} value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="e.g. Slack alerts on failed runs" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
        </Field>
        <Field label="One-liner (optional)">
          <input className={input} value={oneLiner} onChange={(event) => onOneLinerChange(event.target.value)} placeholder="what & why in a sentence" onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
        </Field>
        <Field label="Notes (optional — becomes the brief)">
          <textarea className="min-h-24 resize-y rounded-md border border-hairline-strong bg-panel-inset px-3 py-2 text-base text-text outline-none focus:border-accent" value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="notes (optional) — anything Start should know" />
        </Field>
      </div>
      <div className="mt-6 flex items-center gap-2 border-t border-hairline-soft pt-4">
        <span className="font-mono text-sm text-text-3">feature/{slug || '…'} · draft</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="solid" onClick={submit} disabled={!ready || busy}>{busy ? 'Parking…' : 'Park it'}</Button>
        </div>
      </div>
    </>
  )
}
