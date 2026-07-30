import { useState } from 'react'
import { nextPhase, type EventRow, type Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useEventLog } from '../lib/events'
import type { DocSummary, GateState } from '../lib/api'
import { PHASE_LABELS, undoableOverride } from '../lib/feature-ui'
import { relTime } from '../lib/format'
import { Button, DimLine } from '../ui'
import { IconCheck, IconDoc } from '../icons'
import { DocPeek } from './DocPeek'

/**
 * Right rail for the pipeline-first shell, tabbed so the working surface stays
 * calm: Details (current gate + knowledge docs) is the default; the raw event
 * feed lives behind the Activity tab instead of scrolling permanently beside
 * the workspace.
 */
export function Inspector({ featureId }: { featureId: string }) {
  const [tab, setTab] = useState<'details' | 'activity'>('details')
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  // One feed for both tabs: Activity narrates it, and the gate card reads the
  // undo window for a gate override out of it (findings F24). Mounted here
  // rather than inside Activity so switching tabs doesn't re-accumulate it.
  const events = useEventLog(featureId)

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
      <div className="insp-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'details'}
          className={`insp-tab${tab === 'details' ? ' is-active' : ''}`}
          onClick={() => setTab('details')}
        >
          Details
        </button>
        <button
          role="tab"
          aria-selected={tab === 'activity'}
          className={`insp-tab${tab === 'activity' ? ' is-active' : ''}`}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>

      {tab === 'details' ? (
        <div className="insp-pane" key="details">
          <CurrentGate
            featureId={featureId}
            gate={full.data.gate}
            phase={full.data.feature.phase}
            events={events}
          />
          <Knowledge featureId={featureId} docs={full.data.docs} />
        </div>
      ) : (
        <div className="insp-pane insp-pane-activity" key="activity">
          <Activity events={events} />
        </div>
      )}
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

function CurrentGate({
  featureId,
  gate,
  phase,
  events,
}: {
  featureId: string
  gate: GateState
  phase: Phase
  events: EventRow[]
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const invalidate = () => {
    utils.feature.get.invalidate({ id: featureId })
    utils.feature.list.invalidate()
  }
  // What Apply is actually about to DO. Overriding advances one phase — the
  // consequence the form never stated, so users read "override" as "waive this
  // gate" rather than "skip ahead now" (findings F24).
  const lands = nextPhase({ phase })

  const override = trpc.feature.overrideGate.useMutation({
    onSuccess: (feature) => {
      setReason('')
      setOpen(false)
      invalidate()
      toast.push(`gate overridden — moved to ${PHASE_LABELS[feature.phase]}`, 'success')
    },
    onError: (e) => toast.push(e.message),
  })
  const undo = trpc.feature.undoGateOverride.useMutation({
    onSuccess: (feature) => {
      invalidate()
      toast.push(`override undone — back to ${PHASE_LABELS[feature.phase]}`, 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  // Offered only while the override is still the feature's latest transition —
  // once the pipeline has moved on, stepping back one phase reverses nothing.
  const undoable = undoableOverride(events)

  return (
    <section className="insp-section">
      <div className="insp-cap">Current gate</div>
      {gate.next === null ? (
        <div className="gate-shipped">
          <IconCheck size={13} />
          Shipped — no gates left.
        </div>
      ) : (
        <GateCard
          gateId={gate.next.id}
          name={gateName(gate.next)}
          description={gate.next.description}
          satisfied={gate.satisfied}
          reason={gate.reason}
          consequence={
            lands
              ? `Overriding ${gate.next.id} moves this feature to ${PHASE_LABELS[lands]}.`
              : undefined
          }
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
      {undoable && (
        <div className="gate-undo">
          <span>
            {undoable.gate} was overridden — this feature skipped ahead to{' '}
            {PHASE_LABELS[undoable.to]}.
          </span>
          <Button
            variant="ghost"
            className="btn-xs"
            disabled={undo.isPending}
            onClick={() => undo.mutate({ featureId, gate: undoable.gate })}
          >
            Undo — back to {PHASE_LABELS[undoable.from]}
          </Button>
        </div>
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
  consequence,
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
  /** What Apply will do, stated before it is clicked. */
  consequence: string | undefined
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
        <span>{satisfied ? 'Ready to advance' : reason ?? 'Blocked'}</span>
      </div>

      {open ? (
        <div className="override-form">
          {consequence && <div className="override-consequence">{consequence}</div>}
          <input
            className="override-input"
            placeholder="Reason for override"
            value={reasonValue}
            autoFocus
            onChange={(e) => onReasonChange(e.target.value)}
          />
          <div className="override-actions">
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
        <button className="gate-override-link" onClick={onOpen}>
          Override with reason…
        </button>
      )}
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
        <div className="insp-empty">
          Docs the sessions write — decisions, the spec, the map — collect here.
        </div>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.relPath}>
              <button
                className="doc-link"
                onClick={() => setPeek({ relPath: d.relPath, title: d.title })}
              >
                <span className="doc-link-icon">
                  <IconDoc size={13} />
                </span>
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

/** Event level → dot color class; keeps the feed scannable without mono codes. */
function eventTone(type: string): string {
  if (type.includes('failed') || type.includes('error') || type.includes('blocked')) return 'is-danger'
  if (type.includes('done') || type.includes('shipped') || type.includes('merged')) return 'is-ok'
  if (type.startsWith('phase') || type.startsWith('gate')) return 'is-accent'
  return ''
}

/** `session.pty_exited` → `session · pty exited` */
function humanType(type: string): string {
  return type.replace(/_/g, ' ').replace('.', ' · ')
}

function Activity({ events }: { events: EventRow[] }) {
  const recent = events.slice(-50).reverse()
  return (
    <section className="insp-section">
      {recent.length === 0 ? (
        <div className="insp-empty">Everything that happens to this feature shows up here.</div>
      ) : (
        <div className="activity-log">
          {recent.map((e) => (
            <div key={e.id} className="act-line">
              <span className={`act-dot ${eventTone(e.type)}`} />
              <div className="act-body">
                <div className="act-msg">{e.message}</div>
                <div className="act-sub">
                  <span className="act-type">{humanType(e.type)}</span>
                  <span className="act-time">{relTime(e.ts)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
