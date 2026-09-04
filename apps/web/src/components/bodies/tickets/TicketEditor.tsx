import { useState } from 'react'
import type { Ticket } from '@runcastle/core'
import { Button, TEXT_INPUT } from '../../../ui'

export interface TicketPatch {
  title: string
  goal: string
  context: string
  acceptanceCriteria: string[]
}

export function TicketEditor({ ticket, busy, onCancel, onSave }: { ticket: Ticket; busy: boolean; onCancel: () => void; onSave: (patch: TicketPatch) => void }) {
  const [title, setTitle] = useState(ticket.title)
  const [goal, setGoal] = useState(ticket.goal)
  const [context, setContext] = useState(ticket.context)
  const [criteria, setCriteria] = useState(ticket.acceptanceCriteria.join('\n'))
  const lines = criteria.split('\n').map((line) => line.trim()).filter(Boolean)
  const ready = !!title.trim() && !!goal.trim() && lines.length > 0
  const field = 'grid gap-1.5'
  const heading = 'font-mono text-xs uppercase tracking-wider text-text-4'
  return <div className="grid gap-4 border-t border-hairline bg-panel-2 p-4">
    <label className={field}><span className={heading}>Title</span><input className={TEXT_INPUT} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className={field}><span className={heading}>Goal</span><textarea className={`${TEXT_INPUT} min-h-24 resize-y py-2`} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
    <label className={field}><span className={heading}>Context</span><textarea className={`${TEXT_INPUT} min-h-24 resize-y py-2`} value={context} onChange={(event) => setContext(event.target.value)} /></label>
    <label className={field}><span className={heading}>Acceptance — one per line</span><textarea className={`${TEXT_INPUT} min-h-24 resize-y py-2`} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>
    <div className="flex justify-end gap-2"><Button className="h-7 text-xs" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="solid" className="h-7 text-xs" disabled={!ready || busy} onClick={() => onSave({ title: title.trim(), goal: goal.trim(), context: context.trim(), acceptanceCriteria: lines })}>{busy ? 'Saving…' : 'Save ticket'}</Button></div>
  </div>
}
