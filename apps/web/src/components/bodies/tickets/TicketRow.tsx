import { useState } from 'react'
import type { ModelEntry, Ticket } from '@runcastle/core'
import { shortSha } from '../../../lib/format'
import { ticketModelChip } from '../../../lib/feature-ui'
import { Button, TicketKindChip, TicketStatusChip } from '../../../ui'
import { IconChevronRight } from '../../../icons'
import { Markdown } from '../../Markdown'
import { MessageWithSettingsLink } from '../../settings/MessageWithSettingsLink'
import { ModelMenu } from './ModelMenu'
import { TicketEditor, type TicketPatch } from './TicketEditor'

const EDITABLE_STATUSES = new Set(['pending', 'failed'])

export function TicketRow({ ticket, roster, readonly, onEdit, onModel, onCancel, onCopySha }: {
  ticket: Ticket
  roster: readonly ModelEntry[]
  readonly: boolean
  /** Absent in a frozen record — a pinned row mutates nothing (decision 10). */
  onEdit?: (ticketId: string, patch: TicketPatch) => Promise<void>
  onModel?: (ticketId: string, model: string) => void
  onCancel?: (ticketId: string) => void
  onCopySha?: (sha: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const editable = EDITABLE_STATUSES.has(ticket.status)
  const assigned = ticketModelChip(ticket, roster)
  const heading = 'font-mono text-xs uppercase tracking-wider text-text-4'
  const section = 'grid gap-1.5'

  return <article className="border-b border-hairline last:border-b-0">
    <div className="flex min-h-12 items-center gap-2 px-3">
      <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ticket #${ticket.seq}`} className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-text" onClick={() => setOpen((value) => !value)}>
        <span className={`text-text-4 transition-transform ${open ? 'rotate-90' : ''}`}><IconChevronRight size={11} /></span>
        <span className="font-mono text-xs text-text-3">#{ticket.seq}</span>
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${ticket.status === 'cancelled' ? 'text-text-4' : 'text-text'}`}>{ticket.title}</span>
        <TicketKindChip kind={ticket.kind} />
        {ticket.blockedBy.length > 0 && <span className="font-mono text-xs text-text-4" title="Runs after these tickets land">after #{ticket.blockedBy.join(', #')}</span>}
      </button>
      {editable && !readonly && onModel ? <ModelMenu value={ticket.model ?? ''} roster={roster} onChange={(model) => onModel(ticket.id, model)} /> : assigned && <span className="inline-flex h-5 items-center rounded-pill border border-hairline px-2 font-mono text-xs text-text-2">{assigned.id} · {assigned.runtimeLabel}</span>}
      <TicketStatusChip status={ticket.status} />
    </div>
    {open && editing && onEdit && <TicketEditor ticket={ticket} busy={saving} onCancel={() => setEditing(false)} onSave={(patch) => {
      setSaving(true)
      void onEdit(ticket.id, patch).then(() => setEditing(false), () => undefined).finally(() => setSaving(false))
    }} />}
    {open && !editing && <div className="grid gap-4 border-t border-hairline bg-panel-2 p-4">
      {!readonly && editable && onEdit && onCancel && (confirming ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger/6 p-3 text-sm text-text-2"><span className="mr-auto">Cancel #{ticket.seq}? Tickets that depend on it treat it as done. Its text stays in the ledger.</span><Button className="h-7 text-xs" onClick={() => setConfirming(false)}>Keep it</Button><Button variant="danger" className="h-7 text-xs" onClick={() => onCancel(ticket.id)}>Cancel ticket</Button></div> : <div className="flex gap-2"><Button className="h-7 text-xs" onClick={() => setEditing(true)}>Edit ticket</Button><Button className="h-7 text-xs" onClick={() => setConfirming(true)}>Cancel ticket</Button></div>)}
      <div className={section}><div className={heading}>Goal</div><div className="text-sm text-text-2"><Markdown source={ticket.goal} /></div></div>
      {ticket.context && <div className={section}><div className={heading}>Context</div><div className="text-sm text-text-2"><Markdown source={ticket.context} /></div></div>}
      <div className={section}><div className={heading}>Acceptance</div><ul className="m-0 grid gap-1 pl-5 text-sm text-text-2">{ticket.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></div>
      <div className={section}><div className={heading}>Seams</div><div className="flex flex-wrap gap-1.5">{ticket.seams.map((seam, index) => <span key={index} className="rounded-pill border border-hairline px-2 py-0.5 font-mono text-xs text-text-3">{seam}</span>)}</div></div>
      <div className={section}><div className={heading}>Commits</div>{ticket.commits.length === 0 ? <div className="font-mono text-xs text-text-4">no commits yet — the burn writes them</div> : <div className="flex flex-wrap gap-1.5">{ticket.commits.map((sha) => onCopySha
        ? <button key={sha} type="button" className="rounded-sm border border-hairline bg-transparent px-2 py-1 font-mono text-xs text-text-2" onClick={() => onCopySha(sha)}>{shortSha(sha)}</button>
        : <span key={sha} className="rounded-sm border border-hairline px-2 py-1 font-mono text-xs text-text-2">{shortSha(sha)}</span>)}</div>}</div>
      {ticket.digest && <div className={section}><div className={heading}>Digest</div><div className="text-sm text-text-2"><Markdown source={ticket.digest} /></div></div>}
      {ticket.status === 'failed' && ticket.error && <div className={`${section} rounded-md border border-danger/40 p-3`}><div className="font-mono text-xs uppercase tracking-wider text-danger">Error</div><MessageWithSettingsLink text={ticket.error} /></div>}
      {ticket.status === 'cancelled' && ticket.error && <div className={section}><div className={heading}>Cancelled</div><MessageWithSettingsLink text={ticket.error} /></div>}
    </div>}
  </article>
}
