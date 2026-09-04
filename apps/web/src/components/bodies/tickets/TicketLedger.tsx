import type { ModelEntry, Ticket } from '@runcastle/core'
import type { FeatureFull } from '../../../lib/api'
import { groupByLap } from '../../../lib/feature-ui'
import { EmptyState, LapSections, SectionTitle } from '../../../ui'
import { IconDoc } from '../../../icons'
import { DocsMenu } from '../../DocsMenu'
import { ModelMenu } from './ModelMenu'
import { TicketRow } from './TicketRow'
import type { TicketPatch } from './TicketEditor'

export function ticketLedgerMeta(tickets: readonly Ticket[], lap: number): string {
  const rows = tickets.filter((ticket) => ticket.lap === lap && ticket.status !== 'cancelled')
  const parts = [`${rows.filter((ticket) => ticket.status === 'done').length}/${rows.length} done`, `lap ${lap}`]
  const failed = rows.filter((ticket) => ticket.status === 'failed').length
  const burning = rows.filter((ticket) => ticket.status === 'burning').length
  if (failed) parts.push(`${failed} failed`)
  if (burning) parts.push(`${burning} burning`)
  return parts.join(' · ')
}

export function TicketLedger({ tickets, currentLap, roster, readonly, docs, sandbox, defaultModel, onDoc, onEdit, onModel, onBulkModel, onCancel, onCopySha }: {
  tickets: Ticket[]
  currentLap: number
  roster: readonly ModelEntry[]
  readonly: boolean
  docs: FeatureFull['docs']
  // Everything below belongs to the live ledger. A pinned phase is a frozen
  // record (decision 10) — no header menus, nothing to mutate — so it passes
  // none of them and the header carries the counts alone.
  sandbox?: string
  defaultModel?: string
  onDoc?: (relPath: string) => void
  onEdit?: (ticketId: string, patch: TicketPatch) => Promise<void>
  onModel?: (ticketId: string, model: string) => void
  onBulkModel?: (model: string) => void
  onCancel?: (ticketId: string) => void
  onCopySha?: (sha: string) => void
}) {
  const lapTickets = tickets.filter((ticket) => ticket.lap === currentLap)
  const pending = lapTickets.filter((ticket) => ticket.status === 'pending')
  return <div className="flex min-h-0 flex-col rounded-lg border border-hairline bg-panel">
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-hairline px-3">
      <SectionTitle>Tickets</SectionTitle><span className="font-mono text-xs text-text-3">{ticketLedgerMeta(tickets, currentLap)}</span>
      {/* The menu carries its own `ml-auto` for the artifact pane's header; here
          it belongs beside the counts, so the wrapper absorbs that margin. */}
      {onDoc && <span className="inline-flex"><DocsMenu docs={docs} onPick={onDoc} /></span>}
      {!readonly && <>
        <span className="ml-auto inline-flex h-5 items-center rounded-pill border border-hairline px-2 font-mono text-xs text-text-3">sandbox · {sandbox}</span>
        <span className="inline-flex h-5 items-center rounded-pill border border-hairline px-2 font-mono text-xs text-text-3">{defaultModel}</span>
        {onBulkModel && <ModelMenu value="" roster={roster} disabled={pending.length === 0} label="Model for all pending" onChange={onBulkModel} />}
      </>}
    </header>
    {lapTickets.length === 0 && (readonly
      ? <EmptyState icon={<IconDoc size={16} />} title="No tickets in this lap." compact />
      : <EmptyState icon={<IconDoc size={16} />} title="No tickets yet" hint="The session breaks the spec into tickets — they appear here as they land." compact />)}
    {tickets.length > 0 && <div className="min-h-0 overflow-y-auto">
      <LapSections groups={groupByLap(tickets, currentLap)} currentLap={currentLap} meta={(group) => `${group.rows.filter((ticket) => ticket.status === 'done').length}/${group.rows.filter((ticket) => ticket.status !== 'cancelled').length} done`}>
        {(rows) => rows.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} roster={roster} readonly={readonly} onEdit={onEdit} onModel={onModel} onCancel={onCancel} onCopySha={onCopySha} />)}
      </LapSections>
    </div>}
    {!readonly && <div className="border-t border-hairline px-3 py-2 font-mono text-xs text-text-4">Edit and Cancel are available on pending and failed tickets until you burn.</div>}
  </div>
}
