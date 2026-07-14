import { useEffect, useRef } from 'react'
import type { EventRow, Run } from '@runcastle/core'
import { fmtDateTime, fmtTime, shortId } from '../lib/format'
import { RunStatusBadge } from '../ui'

export function RunPanel({
  runs,
  events,
}: {
  runs: Run[]
  events: EventRow[]
}) {
  const latest = [...runs].sort((a, b) => b.startedAt - a.startedAt)[0]
  const runEvents = latest
    ? events.filter((e) => e.runId === latest.id)
    : []

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [runEvents.length])

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Run</h2>
      </div>
      <div className="card-body">
        {!latest ? (
          <p className="muted">No runs yet. Burn tickets to start one.</p>
        ) : (
          <>
            <div className="run-meta">
              <RunStatusBadge status={latest.status} />
              <span className="mono">{latest.workflow}</span>
              <span className="mono muted">{shortId(latest.id)}</span>
              <span className="muted">
                started {fmtDateTime(latest.startedAt)}
              </span>
              {latest.endedAt && (
                <span className="muted">
                  · ended {fmtDateTime(latest.endedAt)}
                </span>
              )}
            </div>
            {latest.summary && (
              <div className="run-summary">{latest.summary}</div>
            )}
            <div className="event-log" ref={logRef}>
              {runEvents.length === 0 ? (
                <div className="muted">waiting for run events…</div>
              ) : (
                runEvents.map((e) => (
                  <div key={e.id} className="event-line">
                    <span className="ts mono">{fmtTime(e.ts)}</span>
                    <span className="etype mono">{e.type}</span>
                    <span className="emsg">{e.message}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
