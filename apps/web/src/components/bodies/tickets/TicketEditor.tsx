import { useState } from 'react'
import type { Ticket } from '@runcastle/core'
import { IconCheck } from '../../../icons'
import { Button, Field, TextArea, TextField } from '../../../ui'

export interface TicketPatch {
  title: string
  goal: string
  context: string
  acceptanceCriteria: string[]
}

/** A ticket's text, edited in place under its row — clean fields, one primary. */
export function TicketEditor({
  ticket,
  busy,
  onCancel,
  onSave,
}: {
  ticket: Ticket
  busy: boolean
  onCancel: () => void
  onSave: (patch: TicketPatch) => void
}) {
  const [title, setTitle] = useState(ticket.title)
  const [goal, setGoal] = useState(ticket.goal)
  const [context, setContext] = useState(ticket.context)
  const [criteria, setCriteria] = useState(ticket.acceptanceCriteria.join('\n'))
  const lines = criteria
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const ready = !!title.trim() && !!goal.trim() && lines.length > 0
  return (
    <div className="flex flex-col gap-4 pt-1 pr-3 pb-5 pl-10 animate-fade-in">
      <Field label="Title">
        <TextField value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Goal">
        <TextArea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} />
      </Field>
      <Field label="Context">
        <TextArea rows={3} value={context} onChange={(event) => setContext(event.target.value)} />
      </Field>
      <Field label="Acceptance" help="One criterion per line.">
        <TextArea rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={<IconCheck />}
          disabled={!ready || busy}
          onClick={() =>
            onSave({ title: title.trim(), goal: goal.trim(), context: context.trim(), acceptanceCriteria: lines })
          }
        >
          {busy ? 'Saving…' : 'Save ticket'}
        </Button>
      </div>
    </div>
  )
}
