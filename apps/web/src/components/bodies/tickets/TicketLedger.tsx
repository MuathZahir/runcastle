import type { ModelEntry, Ticket } from '@runcastle/core'
import type { FeatureFull } from '../../../lib/api'
import { groupByLap } from '../../../lib/feature-ui'
import { EmptyState, LapSections, List, MetaLine } from '../../../ui'
import { IconCube } from '../../../icons'
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

/**
 * The ticket ledger: one line of counts and ledger-wide controls, then the
 * tickets as a divided list of rows (lap headers once a feature has looped).
 * No frame — the page section around it titles it.
 */
export function TicketLedger({
  tickets,
  currentLap,
  roster,
  readonly = false,
  docs,
  sandbox,
  defaultModel,
  onDoc,
  onEdit,
  onModel,
  onBulkModel,
  onCancel,
  onCopySha,
}: {
  tickets: Ticket[]
  currentLap: number
  roster: readonly ModelEntry[]
  /** A frozen record: counts and rows only (decision 10). */
  readonly?: boolean
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
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1">
        <MetaLine
          items={[
            { text: ticketLedgerMeta(tickets, currentLap) },
            !readonly && !!sandbox && { text: `Sandbox ${sandbox}` },
            !readonly && !!defaultModel && { text: defaultModel, mono: true, title: 'The project’s model for tickets with none of their own' },
          ]}
        />
        <span className="ml-auto flex items-center gap-1">
          {onDoc && <DocsMenu docs={docs} onPick={onDoc} />}
          {!readonly && onBulkModel && (
            <ModelMenu value="" roster={roster} disabled={pending.length === 0} label="Model for all pending" onChange={onBulkModel} />
          )}
        </span>
      </div>
      {lapTickets.length === 0 &&
        (readonly ? (
          <EmptyState icon={<IconCube />} title="No tickets in this lap" compact />
        ) : (
          <EmptyState
            icon={<IconCube />}
            title="No tickets yet"
            hint="The session breaks the spec into tickets — they appear here as they land."
            compact
          />
        ))}
      {tickets.length > 0 && (
        <div className="-mx-3 min-h-0 overflow-y-auto">
          <LapSections
            groups={groupByLap(tickets, currentLap)}
            currentLap={currentLap}
            headClassName="px-3"
            meta={(group) =>
              `${group.rows.filter((ticket) => ticket.status === 'done').length}/${group.rows.filter((ticket) => ticket.status !== 'cancelled').length} done`
            }
          >
            {(rows) => (
              <List divided>
                {rows.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    roster={roster}
                    readonly={readonly}
                    onEdit={onEdit}
                    onModel={onModel}
                    onCancel={onCancel}
                    onCopySha={onCopySha}
                  />
                ))}
              </List>
            )}
          </LapSections>
        </div>
      )}
      {!readonly && (
        <p className="mt-3 mb-0 text-xs text-text-tertiary">
          Edit and Cancel are available on pending and failed tickets until you burn.
        </p>
      )}
    </div>
  )
}
