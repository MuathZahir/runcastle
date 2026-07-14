import { useState } from 'react'
import { PIPELINE } from '@runcastle/core'
import type { FeatureSize, GateDef, Phase } from '@runcastle/core'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button, Modal } from '../ui'

const PHASES: Phase[] = PIPELINE.map((p) => p.phase)

interface GateState {
  next: GateDef | null
  satisfied: boolean
  reason?: string
}

export function PhaseStepper({
  featureId,
  phase,
  size,
  gate,
}: {
  featureId: string
  phase: Phase
  size: FeatureSize
  gate: GateState
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [reason, setReason] = useState('')

  const invalidate = () => {
    utils.feature.get.invalidate({ id: featureId })
    utils.feature.list.invalidate()
  }

  const advance = trpc.feature.advance.useMutation({
    onError: (e) => toast.push(e.message),
    onSuccess: invalidate,
  })
  const override = trpc.feature.overrideGate.useMutation({
    onError: (e) => toast.push(e.message),
    onSuccess: () => {
      setOverrideOpen(false)
      setReason('')
      invalidate()
    },
  })

  const currentIndex = PHASES.indexOf(phase)
  const busy = advance.isPending || override.isPending

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Pipeline</h2>
      </div>
      <div className="card-body">
        <div className="stepper">
          {PHASES.map((p, i) => {
            const skipped = size === 'collapsed' && p === 'spec'
            let state = 'step-upcoming'
            if (skipped) state = 'step-skipped'
            else if (i < currentIndex) state = 'step-done'
            else if (i === currentIndex) state = 'step-current'
            return (
              <div key={p} className={`step ${state}`}>
                <span className="step-dot" />
                <span className="step-label">
                  {p}
                  {skipped ? ' (skipped)' : ''}
                </span>
              </div>
            )
          })}
        </div>

        <div className="gate-info">
          {gate.next ? (
            <>
              <div className="gate-line">
                Next gate <span className="mono">{gate.next.id}</span> —{' '}
                {gate.next.description}{' '}
                {gate.satisfied ? (
                  <span className="gate-ok">ready</span>
                ) : (
                  <span className="gate-block">blocked</span>
                )}
              </div>
              {!gate.satisfied && gate.reason && (
                <div className="gate-reason">{gate.reason}</div>
              )}
              <div className="row-actions">
                <Button
                  variant="primary"
                  disabled={!gate.satisfied || busy}
                  onClick={() => advance.mutate({ featureId })}
                >
                  Advance
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setOverrideOpen(true)}
                >
                  Override…
                </Button>
              </div>
            </>
          ) : (
            <div className="muted">Feature is at the final phase.</div>
          )}
        </div>
      </div>

      {overrideOpen && gate.next && (
        <Modal
          title={`Override gate ${gate.next.id}`}
          onClose={() => setOverrideOpen(false)}
        >
          <p className="muted">
            Overriding records a reason and advances the phase regardless of the
            gate check.
          </p>
          <div className="field">
            <label>Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why are you overriding this gate?"
            />
          </div>
          <div className="modal-actions">
            <Button
              variant="ghost"
              onClick={() => setOverrideOpen(false)}
              disabled={override.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || override.isPending}
              onClick={() =>
                override.mutate({
                  featureId,
                  gate: gate.next!.id,
                  reason: reason.trim(),
                })
              }
            >
              {override.isPending ? 'Working…' : 'Override & advance'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
