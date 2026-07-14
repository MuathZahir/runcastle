import type { EventRow } from '@runcastle/core'
import { fmtTime } from '../lib/format'

export function Timeline({ events }: { events: EventRow[] }) {
  const rows = [...events].sort((a, b) => b.id - a.id)

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Timeline</h2>
        <span className="muted">{events.length}</span>
      </div>
      <div className="card-body">
        {rows.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <div className="timeline">
            {rows.map((e) => (
              <div key={e.id} className="timeline-row">
                <span className="ts mono">{fmtTime(e.ts)}</span>
                <span className="etype mono">{e.type}</span>
                <span className="emsg">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
