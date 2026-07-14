import { useState } from 'react'
import type { Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useEventLog } from '../lib/events'
import { PHASE_ORDER } from '../lib/feature-ui'
import type { FeatureFull } from '../lib/api'
import { relTime } from '../lib/format'
import { DimLine, SectionTitle } from '../ui'
import { DocPeek } from './DocPeek'

/**
 * Inspector right rail (UI-SPEC §2), bound to the active tab's feature: three
 * stacked sections — Pipeline (vertical mini-stepper + gate + advance/override),
 * Knowledge (doc peeks), Activity (recent events).
 */
export function Inspector({ featureId }: { featureId: string }) {
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })

  if (full.isLoading)
    return <div className="inspector"><DimLine>loading…</DimLine></div>
  if (full.error || !full.data)
    return <div className="inspector"><DimLine>could not load inspector</DimLine></div>

  return (
    <div className="inspector">
      <PipelineSection featureId={featureId} data={full.data} />
      <KnowledgeSection featureId={featureId} data={full.data} />
      <ActivitySection featureId={featureId} />
    </div>
  )
}

function PipelineSection({ featureId, data }: { featureId: string; data: FeatureFull }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const [overriding, setOverriding] = useState(false)
  const [reason, setReason] = useState('')

  const invalidate = () => {
    utils.feature.get.invalidate({ id: featureId })
    utils.feature.list.invalidate()
  }
  const advance = trpc.feature.advance.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.push(e.message),
  })
  const override = trpc.feature.overrideGate.useMutation({
    onSuccess: () => {
      invalidate()
      setOverriding(false)
      setReason('')
    },
    onError: (e) => toast.push(e.message),
  })

  const { feature, gate } = data
  const currentIdx = PHASE_ORDER.indexOf(feature.phase)
  const collapsed = feature.size === 'collapsed'

  const rowState = (phase: Phase, idx: number): string => {
    if (collapsed && phase === 'spec') return 'skipped'
    if (idx < currentIdx) return 'done'
    if (idx === currentIdx) return 'current'
    return 'upcoming'
  }

  const busy = advance.isPending || override.isPending

  return (
    <section className="insp-section">
      <SectionTitle>Pipeline</SectionTitle>
      <div className="stepper">
        {PHASE_ORDER.map((phase, idx) => {
          const st = rowState(phase, idx)
          return (
            <div key={phase} className={`step step-${st}`}>
              <span className={`step-mark phase-fg-${phase}`} />
              <span className="step-label mono">{phase}</span>
            </div>
          )
        })}
      </div>

      {gate.next ? (
        <div className="gate">
          <div className={`gate-line mono ${gate.satisfied ? 'gate-ok' : 'gate-block'}`}>
            {gate.next.id} · {gate.satisfied ? 'satisfied' : `blocked — ${gate.reason ?? 'not satisfied'}`}
          </div>
          {overriding ? (
            <form
              className="override-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!reason.trim()) {
                  toast.push('override reason is required')
                  return
                }
                override.mutate({ featureId, gate: gate.next!.id, reason: reason.trim() })
              }}
            >
              <input
                className="nf-input"
                placeholder="override reason"
                value={reason}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="nf-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setOverriding(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-ghost btn-xs" disabled={busy}>
                  Override
                </button>
              </div>
            </form>
          ) : (
            <div className="gate-actions">
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => advance.mutate({ featureId })}
                disabled={busy}
              >
                Advance
              </button>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setOverriding(true)}
                disabled={busy}
              >
                Override…
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="gate">
          <div className="gate-line mono gate-ok">shipped — pipeline complete</div>
        </div>
      )}
    </section>
  )
}

function KnowledgeSection({ featureId, data }: { featureId: string; data: FeatureFull }) {
  const [peek, setPeek] = useState<{ relPath: string; title: string } | null>(null)
  return (
    <section className="insp-section">
      <SectionTitle>Knowledge</SectionTitle>
      {data.docs.length === 0 ? (
        <DimLine>no docs yet</DimLine>
      ) : (
        <ul className="doc-list">
          {data.docs.map((d) => (
            <li key={d.relPath}>
              <button className="doc-link" onClick={() => setPeek({ relPath: d.relPath, title: d.title })}>
                <span className="doc-title">{d.title}</span>
                <span className="doc-path mono dim">{d.relPath}</span>
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

function ActivitySection({ featureId }: { featureId: string }) {
  const events = useEventLog(featureId)
  const recent = events.slice(-15).reverse()
  return (
    <section className="insp-section insp-activity">
      <SectionTitle>Activity</SectionTitle>
      {recent.length === 0 ? (
        <DimLine>no activity</DimLine>
      ) : (
        <div className="activity-log">
          {recent.map((e) => (
            <div key={e.id} className="act-line mono">
              <span className="act-time">{relTime(e.ts)}</span>
              <span className="act-type">{e.type}</span>
              <span className="act-msg">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
