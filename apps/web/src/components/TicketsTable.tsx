import type { Ticket } from '@runcastle/core'
import { TicketStatusChip } from '../ui'

export function TicketsTable({ tickets }: { tickets: Ticket[] }) {
  const sorted = [...tickets].sort((a, b) => a.seq - b.seq)

  if (sorted.length === 0) {
    return (
      <p className="muted">
        No tickets yet — run an ideation session to emit tickets.
      </p>
    )
  }

  return (
    <div className="table-wrap">
      <table className="tickets-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Status</th>
            <th>Blocked by</th>
            <th>Commits</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.seq}</td>
              <td>{t.title}</td>
              <td>
                <TicketStatusChip status={t.status} />
              </td>
              <td className="mono">
                {t.blockedBy.length ? t.blockedBy.join(', ') : '—'}
              </td>
              <td className="mono">{t.commits.length}</td>
              <td>
                {t.error && (
                  <span className="err-dot" title={t.error}>
                    !
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
