import { Fragment } from 'react'
import type { Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button, DimLine, PhaseTag } from '../ui'
import type { FeatureFull } from '../lib/api'
import type { DriveState } from '../lib/workspace'
import {
  effectivePhase,
  isReadonlyView,
  latestRun,
  nextStep,
  PHASE_LABELS,
  pipelineSteps,
  type ActionKind,
  type NextStep,
  type PipelineStep,
} from '../lib/feature-ui'
import { GrillBody } from './bodies/GrillBody'
import { ReviewBody } from './bodies/ReviewBody'
import { ShippedBody } from './bodies/ShippedBody'
import { TicketsBody } from './bodies/TicketsBody'
import { RunBody } from './bodies/RunBody'

/**
 * The pipeline-first workspace (app-redesign). A selected feature fills the
 * center: a header, a clickable horizontal pipeline stepper, a single guided
 * next-step bar (one solid action), and the body for the phase currently in
 * view. Clicking an earlier step pins a read-only view of that phase; the
 * next-step bar is replaced by a read-only banner until you snap back to live.
 */
export function Workspace({
  featureId,
  viewedPhase,
  onViewPhase,
  guidance,
  driving,
  onDriveChange,
}: {
  featureId: string
  viewedPhase: Phase | null
  onViewPhase: (phase: Phase | null) => void
  guidance: boolean
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })

  const invalidate = () => {
    void utils.feature.get.invalidate({ id: featureId })
    void utils.feature.list.invalidate()
  }

  const launch = trpc.feature.launchSession.useMutation({ onSuccess: invalidate, onError: (e) => toast.push(e.message) })
  const advance = trpc.feature.advance.useMutation({
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
    },
    onError: (e) => toast.push(e.message),
  })
  const burn = trpc.feature.burn.useMutation({
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
    },
    onError: (e) => toast.push(e.message),
  })
  const cancel = trpc.run.cancel.useMutation({
    onSuccess: () => {
      invalidate()
      toast.push('cancel requested', 'info')
    },
    onError: (e) => toast.push(e.message),
  })
  const testDrive = trpc.feature.testDrive.useMutation({ onError: (e) => toast.push(e.message) })
  const merge = trpc.feature.merge.useMutation({ onError: (e) => toast.push(e.message) })

  if (q.isLoading) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>loading feature…</DimLine>
        </div>
      </section>
    )
  }
  if (q.error || !q.data) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>could not load feature{q.error ? `: ${q.error.message}` : ''}</DimLine>
        </div>
      </section>
    )
  }

  const full = q.data
  const feature = full.feature
  const effective = effectivePhase(feature, viewedPhase)
  const readonly = isReadonlyView(feature, effective)
  const steps = pipelineSteps(feature, effective)
  const run = latestRun(full.runs)
  const isDriving = driving?.featureId === feature.id
  const ns = nextStep(full, { driving: isDriving })
  const busy =
    launch.isPending ||
    advance.isPending ||
    burn.isPending ||
    cancel.isPending ||
    testDrive.isPending ||
    merge.isPending

  const runAction = (kind: ActionKind) => {
    switch (kind) {
      case 'startGrill':
        launch.mutate({ featureId, kind: 'ideation' })
        break
      case 'askQuestions':
        launch.mutate({ featureId, kind: 'qa' })
        break
      case 'openGrill':
        onViewPhase(null)
        requestAnimationFrame(() =>
          document.getElementById('grill-term')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        )
        break
      case 'advance':
        advance.mutate({ featureId })
        break
      case 'burn':
        burn.mutate({ featureId })
        break
      case 'cancelRun':
        if (run) cancel.mutate({ runId: run.id })
        break
      case 'testDriveStart':
        testDrive.mutate(
          { featureId, action: 'start' },
          {
            onSuccess: (res) => {
              invalidate()
              if (res.ok && res.branch) onDriveChange({ featureId, branch: res.branch })
              else if (!res.ok) toast.push(res.deniedReason ?? 'test drive denied')
            },
          },
        )
        break
      case 'testDriveStop':
        testDrive.mutate(
          { featureId, action: 'stop' },
          {
            onSuccess: () => {
              invalidate()
              onDriveChange(null)
            },
          },
        )
        break
      case 'merge':
        merge.mutate(
          { featureId },
          {
            onSuccess: (res) => {
              invalidate()
              if (res.ok) {
                onDriveChange(null)
                toast.push('merged — feature shipped', 'success')
              } else if (res.conflict) {
                toast.push('merge conflict — resolve and retry')
              }
            },
          },
        )
        break
    }
  }

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <PhaseTag phase={feature.phase} />
          <span className="ws-title">{feature.title}</span>
          <span className="ws-title-spacer" />
          <button className="ws-branch" title="copy branch" onClick={() => copyText(feature.branch, toast)}>
            ⎇ {feature.branch}
          </button>
        </div>
        <PipelineStepper
          steps={steps}
          onView={(p) => onViewPhase(p === feature.phase ? null : p)}
        />
      </div>

      {readonly ? (
        <div className="readonly-bar">
          <span className="readonly-tag">READ-ONLY</span>
          <span>You're viewing the {PHASE_LABELS[effective]} phase.</span>
          <button className="readonly-back" onClick={() => onViewPhase(null)}>
            Back to {PHASE_LABELS[feature.phase]} →
          </button>
        </div>
      ) : (
        <NextStepBar ns={ns} guidance={guidance} busy={busy} onAction={runAction} />
      )}

      <div className="ws-body">
        <div className="ws-body-inner" key={effective}>
          <PhaseBody
            effective={effective}
            full={full}
            driving={driving}
            runId={run?.id ?? null}
            readonly={readonly}
          />
        </div>
      </div>
    </section>
  )
}

function PhaseBody({
  effective,
  full,
  driving,
  runId,
  readonly,
}: {
  effective: Phase
  full: FeatureFull
  driving: DriveState | null
  runId: string | null
  readonly: boolean
}) {
  switch (effective) {
    case 'ideation':
    case 'spec':
      return <GrillBody full={full} effective={effective} />
    case 'tickets':
      return <TicketsBody featureId={full.feature.id} readonly={readonly} />
    case 'implementation':
      return <RunBody featureId={full.feature.id} runId={runId} readonly={readonly} />
    case 'review':
      return <ReviewBody full={full} driving={driving} />
    case 'shipped':
      return <ShippedBody full={full} />
  }
}

function PipelineStepper({
  steps,
  onView,
}: {
  steps: PipelineStep[]
  onView: (phase: Phase) => void
}) {
  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <Fragment key={s.phase}>
          <button
            className={`pstep is-${s.state}${s.isViewed ? ' is-viewed' : ''}${s.clickable ? ' is-clickable' : ''}`}
            title={s.tip}
            disabled={!s.clickable}
            onClick={() => s.clickable && onView(s.phase)}
          >
            <span className="pstep-dot" />
            <span className="pstep-label">{s.label}</span>
          </button>
          {i < steps.length - 1 && (
            <span className={`pconn${s.state === 'done' ? ' is-done' : ''}`} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

function NextStepBar({
  ns,
  guidance,
  busy,
  onAction,
}: {
  ns: NextStep
  guidance: boolean
  busy: boolean
  onAction: (kind: ActionKind) => void
}) {
  const kickClass =
    ns.kick === 'IN PROGRESS'
      ? 'is-progress'
      : ns.kick === 'SHIPPED'
        ? 'is-shipped'
        : ns.kick === 'WAITING'
          ? 'is-waiting'
          : ''

  return (
    <div className="nextstep">
      {ns.busy && <span className="spin-ring nextstep-spin" />}
      <div className="nextstep-main">
        <div className={`nextstep-kick ${kickClass}`}>{ns.kick}</div>
        <div className="nextstep-title">{ns.title}</div>
        {guidance && <div className="nextstep-desc">{ns.desc}</div>}
      </div>
      <div className="nextstep-actions">
        {ns.secondary.map((a, i) => (
          <Button key={i} variant="ghost" className="btn-xs" disabled={busy} onClick={() => onAction(a.kind)}>
            {a.label}
          </Button>
        ))}
        {ns.primary && (
          <Button
            variant={ns.primary.danger ? 'danger' : 'solid'}
            disabled={busy}
            onClick={() => onAction(ns.primary!.kind)}
          >
            {busy ? 'Working…' : ns.primary.label}
          </Button>
        )}
      </div>
    </div>
  )
}

function copyText(text: string, toast: { push: (m: string, k?: 'error' | 'info' | 'success') => void }): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.push(`copied ${text}`, 'info'))
    .catch(() => toast.push('copy failed'))
}
