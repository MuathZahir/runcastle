import { useState } from 'react'
import type { Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { MODEL, SANDBOX_MODE } from '../../lib/env'
import type { Tab } from '../../lib/tabs'
import { shortSha } from '../../lib/format'
import { DimLine, TicketStatusChip } from '../../ui'

/**
 * Tickets tab (UI-SPEC §3): burn bar (counts + sandbox/model chips + the single
 * solid Burn button, disabled with a reason when the gate is unsatisfied) over a
 * ticket ledger. Rows expand in place to full goal/context/criteria/seams.
 */
export function TicketsTab({
  featureId,
  onOpenTab,
}: {
  featureId: string
  onOpenTab: (tab: Tab) => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })

  const burn = trpc.feature.burn.useMutation({
    onSuccess: ({ runId }) => {
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
      onOpenTab({ kind: 'run', featureId, runId })
    },
    onError: (e) => toast.push(e.message),
  })

  if (full.isLoading) return <div className="tickets"><DimLine>loading tickets…</DimLine></div>
  if (full.error || !full.data)
    return <div className="tickets"><DimLine>could not load tickets: {full.error?.message ?? 'unknown'}</DimLine></div>

  const { feature, tickets, gate } = full.data
  const blocked = tickets.filter((t) => t.blockedBy.length > 0).length
  const canBurn = feature.phase === 'tickets' && tickets.length > 0
  const burnReason = !canBurn
    ? feature.phase !== 'tickets'
      ? `advance to the tickets phase to burn (currently ${feature.phase})`
      : (gate.reason ?? 'no tickets to burn')
    : undefined

  return (
    <div className="tickets">
      <div className="burn-bar">
        <div className="burn-counts mono">
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
          <span className="burn-sep"> · </span>
          {blocked} blocked
        </div>
        <div className="burn-right">
          <span className="chip chip-neutral" title="sandbox">{SANDBOX_MODE}</span>
          <span className="chip chip-neutral" title="model">{MODEL}</span>
          <button
            className="btn btn-solid"
            disabled={!canBurn || burn.isPending}
            title={burnReason}
            onClick={() => burn.mutate({ featureId })}
          >
            {burn.isPending ? 'Burning…' : `Burn ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <div className="ledger">
        {tickets.length === 0 && <DimLine>no tickets emitted yet — grill the feature to shape them</DimLine>}
        {tickets.map((t) => (
          <TicketRow key={t.id} ticket={t} />
        ))}
      </div>
    </div>
  )
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`ledger-row status-${ticket.status}${open ? ' is-open' : ''}`}>
      <button className="ledger-head" onClick={() => setOpen((v) => !v)}>
        <span className="lg-seq mono">#{ticket.seq}</span>
        <span className="lg-title">{ticket.title}</span>
        <span className="lg-meta">
          {ticket.blockedBy.length > 0 && (
            <span className="chip chip-blocked mono" title="blocked by">
              ⇠ {ticket.blockedBy.join(',')}
            </span>
          )}
          {ticket.commits.length > 0 && (
            <span className="lg-commits mono" title="commits">
              {ticket.commits.length}⧉
            </span>
          )}
          <TicketStatusChip status={ticket.status} />
        </span>
      </button>

      {open && (
        <div className="ledger-detail mono">
          <TicketSection title="Goal" body={ticket.goal} />
          <TicketSection title="Context" body={ticket.context} />
          <div className="td-section">
            <div className="td-heading"># Acceptance criteria</div>
            {ticket.acceptanceCriteria.length === 0 ? (
              <div className="dim-line">none specified</div>
            ) : (
              <ul className="td-list">
                {ticket.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="td-section">
            <div className="td-heading"># Seams</div>
            {ticket.seams.length === 0 ? (
              <div className="dim-line">none specified</div>
            ) : (
              <ul className="td-list">
                {ticket.seams.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </div>
          {ticket.commits.length > 0 && (
            <div className="td-section">
              <div className="td-heading"># Commits</div>
              <div className="td-commits">
                {ticket.commits.map((c) => (
                  <span key={c} className="commit-sha">{shortSha(c)}</span>
                ))}
              </div>
            </div>
          )}
          {ticket.status === 'failed' && ticket.error && (
            <div className="td-section td-error">
              <div className="td-heading"># Error</div>
              <div className="td-error-body">{ticket.error}</div>
              <div className="dim-line">Recovery: fix the blocker, then re-burn the feature.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TicketSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="td-section">
      <div className="td-heading"># {title.toLowerCase()}</div>
      <div className="td-body">{body || <span className="dim-line">—</span>}</div>
    </div>
  )
}
