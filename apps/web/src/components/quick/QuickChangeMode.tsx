import type { KeyboardEvent, RefObject } from 'react'
import { BranchMenu, Button, Field } from '../../ui'

export function QuickChangeMode({
  title,
  duplicate,
  tickets,
  writtenCount,
  slug,
  base,
  branches,
  detectedBranch,
  busy,
  ready,
  rowRefs,
  onTitleChange,
  onTicketChange,
  onAddTicket,
  onRemoveTicket,
  onBasePick,
  onSubmit,
  onCancel,
}: {
  title: string
  duplicate: string | null
  tickets: string[]
  writtenCount: number
  slug: string
  base: string
  branches: string[] | undefined
  detectedBranch?: string
  busy: boolean
  ready: boolean
  rowRefs: RefObject<(HTMLTextAreaElement | null)[]>
  onTitleChange: (value: string) => void
  onTicketChange: (index: number, value: string) => void
  onAddTicket: (after: number) => void
  onRemoveTicket: (index: number) => void
  onBasePick: (branch: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const ticketKey = (event: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    if (event.key !== 'Enter') return
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      onSubmit()
    } else if (!event.shiftKey) {
      event.preventDefault()
      onAddTicket(index)
    }
  }

  return (
    <>
      <div className="mt-2 flex flex-col gap-2">
        <h2 className="m-0 text-xl font-semibold text-text">What needs changing?</h2>
        <p className="m-0 text-base text-text-2">Each sentence becomes a ticket; you review, then burn.</p>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <Field label="Title" error={duplicate}>
          <input
            className="h-(--control-h) rounded-md border border-hairline-strong bg-panel-inset px-3 text-base text-text outline-none focus:border-accent"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="e.g. Darker empty state"
            autoFocus
          />
        </Field>
        <Field label="Changes">
          <div className="flex flex-col gap-2">
            {tickets.map((ticket, index) => (
              <div className="flex items-start gap-2" key={index}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-panel-3 font-mono text-xs text-text-3">
                  {index + 1}
                </span>
                <textarea
                  className="min-h-16 flex-1 resize-y rounded-md border border-hairline-strong bg-panel-inset px-3 py-2 text-base text-text outline-none focus:border-accent"
                  ref={(element) => { rowRefs.current[index] = element }}
                  value={ticket}
                  onChange={(event) => onTicketChange(index, event.target.value)}
                  placeholder={index === 0 ? 'One change, in your own words — this becomes the ticket, verbatim.' : 'Another change…'}
                  onKeyDown={(event) => ticketKey(event, index)}
                />
                {tickets.length > 1 && (
                  <button
                    type="button"
                    className="size-8 shrink-0 rounded-md text-lg text-text-3 hover:bg-panel-3 hover:text-danger"
                    onClick={() => onRemoveTicket(index)}
                    aria-label={`Remove ticket ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="self-start text-sm text-accent-hi hover:text-accent-2" onClick={() => onAddTicket(tickets.length - 1)}>
              + Add another
            </button>
          </div>
        </Field>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hairline-soft pt-4">
        <span className="font-mono text-sm text-text-3"><strong className="font-medium text-text-2">feature/{slug || '…'}</strong> ·</span>
        <BranchMenu prefix="from" value={base || null} branches={branches} detected={detectedBranch} onPick={onBasePick} missing={!!branches && !base} />
        <span className="font-mono text-sm text-text-3">· {writtenCount || 1} ticket{(writtenCount || 1) === 1 ? '' : 's'} + review</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="solid" onClick={onSubmit} disabled={!ready || busy}>{busy ? 'Creating…' : 'Create feature'}</Button>
        </div>
      </div>
    </>
  )
}
