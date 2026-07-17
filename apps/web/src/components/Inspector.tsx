import { useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useEventLog } from '../lib/events'
import type { DocSummary, GateState } from '../lib/api'
import { relTime } from '../lib/format'
import { Button, DimLine } from '../ui'
import { DocPeek } from './DocPeek'

/**
 * Inspector right rail for the pipeline-first shell. The vertical stepper now
 * lives in the workspace, so this rail no longer advances the pipeline — it
 * shows three stacked read-mostly sections: Current gate (with override-only
 * escape hatch), Knowledge (doc peeks), and Activity (recent events).
 */
export function Inspector({ featureId }: { featureId: string }) {
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })

  if (full.isLoading)
    return (
      <aside className="inspector">
        <DimLine>loading…</DimLine>
      </aside>
    )
  // Hard error only when there was NEVER data — a refetch failure after data
  // exists (server restart) keeps the last-good rail rendered instead of
  // blanking it; the workspace's OFFLINE banner covers the outage story.
  if (!full.data)
    return (
      <aside className="inspector">
        <DimLine>{full.error?.message ?? 'could not load inspector'}</DimLine>
      </aside>
    )

  return (
    <aside className="inspector">
      <CurrentGate featureId={featureId} gate={full.data.gate} />
      <Knowledge featureId={featureId} docs={full.data.docs} />
      <Activity featureId={featureId} />
    </aside>
  )
}

const GATE_NAMES: Record<string, string> = {
  G1: 'Decisions captured',
  G2: 'Spec written',
  G3: 'Tickets approved',
  G4: 'Run clean',
  G5: 'Merged',
}

/**
 * G1 is conditional on `mapped` (ADR-0001 §13.1): its check swaps to
 * `all-waypoints-terminal`, so the short name follows the check, not the id.
 */
function gateName(gate: NonNullable<GateState['next']>): string {
  if (gate.check === 'all-waypoints-terminal') return 'Waypoints resolved'
  return GATE_NAMES[gate.id] ?? gate.id
}

function CurrentGate({ featureId, gate }: { featureId: string; gate: GateState }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const override = trpc.feature.overrideGate.useMutation({
    onSuccess: () => {
      setReason('')
      setOpen(false)
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <section className="insp-section">
      <div className="insp-cap">Current gate</div>
      {gate.next === null ? (
        <div className="gate-empty">No gate — this feature is shipped.</div>
      ) : (
        <GateCard
          gateId={gate.next.id}
          name={gateName(gate.next)}
          description={gate.next.description}
          satisfied={gate.satisfied}
          reason={gate.reason}
          open={open}
          reasonValue={reason}
          pending={override.isPending}
          onOpen={() => setOpen(true)}
          onCancel={() => {
            setOpen(false)
            setReason('')
          }}
          onReasonChange={setReason}
          onApply={() =>
            override.mutate({ featureId, gate: gate.next!.id, reason: reason.trim() })
          }
        />
      )}
    </section>
  )
}

function GateCard({
  gateId,
  name,
  description,
  satisfied,
  reason,
  open,
  reasonValue,
  pending,
  onOpen,
  onCancel,
  onReasonChange,
  onApply,
}: {
  gateId: string
  name: string
  description: string
  satisfied: boolean
  reason: string | undefined
  open: boolean
  reasonValue: string
  pending: boolean
  onOpen: () => void
  onCancel: () => void
  onReasonChange: (v: string) => void
  onApply: () => void
}) {
  return (
    <div className="gate-card">
      <div className="gate-idrow">
        <span className="gate-id">{gateId}</span>
        <span className="gate-name">{name}</span>
      </div>
      <div className="gate-req">{description}</div>
      <div className={`gate-state ${satisfied ? 'is-ok' : 'is-block'}`}>
        <span className="gate-state-dot" />
        <span>{satisfied ? 'ready to advance' : reason ?? 'blocked'}</span>
      </div>

      {open ? (
        <div className="override-form">
          <input
            className="override-input"
            placeholder="reason for override"
            value={reasonValue}
            autoFocus
            onChange={(e) => onReasonChange(e.target.value)}
          />
          <div>
            <Button
              variant="solid"
              className="btn-xs"
              disabled={!reasonValue.trim() || pending}
              onClick={onApply}
            >
              Apply
            </Button>
            <Button variant="ghost" className="btn-xs" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="btn-xs" onClick={onOpen}>
          Override with reason…
        </Button>
      )}

      <div className="gate-hint">
        The highlighted action in the workspace advances this gate.
      </div>
    </div>
  )
}

function basename(relPath: string): string {
  return relPath.split(/[\\/]/).pop() ?? relPath
}

function Knowledge({ featureId, docs }: { featureId: string; docs: DocSummary[] }) {
  const [peek, setPeek] = useState<{ relPath: string; title: string } | null>(null)
  return (
    <section className="insp-section">
      <div className="insp-cap">Knowledge</div>
      {docs.length === 0 ? (
        <DimLine>no docs yet</DimLine>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.relPath}>
              <button
                className="doc-link"
                onClick={() => setPeek({ relPath: d.relPath, title: d.title })}
              >
                <span className="doc-title">{d.title}</span>
                <span className="doc-meta">{basename(d.relPath)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {peek && (
        <DocPeek
          featureId={featureId}
          relPath={peek.relPath}
          title={peek.title}
          onClose={() => setPeek(null)}
        />
      )}
    </section>
  )
}

function Activity({ featureId }: { featureId: string }) {
  const events = useEventLog(featureId)
  const recent = events.slice(-12).reverse()
  return (
    <section className="insp-section">
      <div className="insp-cap">Activity</div>
      {recent.length === 0 ? (
        <DimLine>no activity yet</DimLine>
      ) : (
        <div className="activity-log">
          {recent.map((e) => (
            <div key={e.id} className="act-line">
              <span className="act-time">{relTime(e.ts)}</span>
              <div className="act-body">
                <div className="act-type">{e.type}</div>
                <div className="act-msg">{e.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
