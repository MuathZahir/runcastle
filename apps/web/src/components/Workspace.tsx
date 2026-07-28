import { Fragment, useEffect, useRef, useState } from 'react'
import type { EventRow, Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { useToast } from '../lib/toast'
import { Button, DimLine, PhaseTag } from '../ui'
import type { FeatureFull } from '../lib/api'
import type { DriveState } from '../lib/workspace'
import {
  effectivePhase,
  isReadonlyView,
  latestRun,
  mapDocPath,
  nextStep,
  PHASE_LABELS,
  pipelineSteps,
  REVIEW_ITERATE_KICKOFF,
  type ActionKind,
  type NextAction,
  type NextStep,
  type PipelineStep,
  type ReasonPrompt,
} from '../lib/feature-ui'
import { IconBranch } from '../icons'
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
  mapRailCollapsed,
  onToggleMapRail,
  driving,
  onDriveChange,
}: {
  featureId: string
  viewedPhase: Phase | null
  onViewPhase: (phase: Phase | null) => void
  guidance: boolean
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const resumeFailed = useResumeFailedAlert(featureId)
  // The next-step bar warns about remaining fog on a mapped feature, which lives
  // in the map doc's prose — same query key as the map rail's read, so the two
  // share one fetch.
  const mapRelPath = q.data ? mapDocPath(q.data) : undefined
  const mapQ = trpc.docs.read.useQuery(
    { featureId, relPath: mapRelPath ?? 'map.md' },
    { enabled: !!mapRelPath },
  )

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
  // Convergence is the bar's own action on a mapped feature (decision #4): it
  // crosses G1 — with an override reason when waypoints are still open — and
  // spawns the converge session, which lands the feature at `spec`.
  const converge = trpc.feature.converge.useMutation({
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
  const testDrive = trpc.feature.testDrive.useMutation({
    onSuccess: (res) => {
      // The project's own setup/teardown command failed. Surfaced first and as
      // an error: everything below is advisory, but a failed setup means the
      // app you are about to open probably is not running. The command's output
      // is in the timeline — the toast names which command, not why.
      if (res.hookFailure) {
        const f = res.hookFailure
        toast.push(
          `${f.phase === 'setup' ? 'Test drive setup' : 'Test drive teardown'} failed: ${f.command}${
            f.timedOut ? ' (timed out)' : ''
          } — see the timeline for its output`,
        )
      }
      // Git switches files; it cannot switch the dev database. When the drive's
      // branch carried migrations this one does not have, whatever was migrated
      // during the drive is still applied — and the next `migrate` reports drift
      // with nothing to connect it back to the test drive. Say so now, while the
      // cause is still obvious, and hand over the project's own reset command.
      // Never run it: a dev database can hold hand-built state.
      if (res.dbDrift) {
        toast.push(
          res.dbDrift.resetCommand
            ? `Migrations differ between the branches — your dev database may be ahead. Rebuild it with: ${res.dbDrift.resetCommand}`
            : 'Migrations differ between the branches — your dev database may be ahead. Set a database reset command in settings for a one-line fix here.',
          'info',
        )
      }
      if (res.carriedChanges?.length) {
        toast.push(
          `${res.carriedChanges.length} uncommitted file(s) came back with you onto ${res.branch}`,
          'info',
        )
      }
    },
    onError: (e) => toast.push(e.message),
  })
  const merge = trpc.feature.merge.useMutation({ onError: (e) => toast.push(e.message) })
  const unarchive = trpc.feature.unarchive.useMutation({
    onSuccess: () => {
      invalidate()
      toast.push('feature unarchived', 'success')
    },
    onError: (e) => toast.push(e.message),
  })

  if (q.isLoading) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>loading feature…</DimLine>
        </div>
      </section>
    )
  }
  // Hard error ONLY when there was never data (first load failed). When a
  // refetch fails AFTER data exists (server restart mid-session), TanStack Query
  // keeps the last-good `data` alongside `error` — keep rendering it so the
  // embedded terminal stays MOUNTED (its own reconnect strip + scrollback replay
  // depend on surviving the outage) and show a slim banner instead. The 1.5s
  // refetchInterval keeps polling through the error, so the banner self-clears
  // the moment the server is back.
  if (!q.data) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>could not load feature{q.error ? `: ${q.error.message}` : ''}</DimLine>
        </div>
      </section>
    )
  }
  const offline = !!q.error

  const full = q.data
  const feature = full.feature
  const effective = effectivePhase(feature, viewedPhase)
  const readonly = isReadonlyView(feature, effective)
  const steps = pipelineSteps(feature, effective)
  const run = latestRun(full.runs)
  const isDriving = driving?.featureId === feature.id
  const ns = nextStep(full, { driving: isDriving, mapContent: mapQ.data?.content })
  const busy =
    launch.isPending ||
    advance.isPending ||
    burn.isPending ||
    converge.isPending ||
    cancel.isPending ||
    testDrive.isPending ||
    merge.isPending ||
    unarchive.isPending

  const runAction = (kind: ActionKind, reason?: string) => {
    switch (kind) {
      case 'startGrill':
        launch.mutate({ featureId, kind: 'ideation' })
        break
      case 'askQuestions':
        launch.mutate({ featureId, kind: 'qa' })
        break
      case 'revisit':
        launch.mutate({
          featureId,
          kind: 'revisit',
          // At review the revisit is an Iterate loop — brief the agent to read
          // the run outcome, interview about the test drive, and emit fix tickets
          // (ticket-3 kickoff override). Other phases use the default revisit line.
          kickoffLine: feature.phase === 'review' ? REVIEW_ITERATE_KICKOFF : undefined,
        })
        break
      case 'openGrill':
        onViewPhase(null)
        requestAnimationFrame(() =>
          document.getElementById('grill-term')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        )
        break
      case 'converge':
        converge.mutate({ featureId })
        break
      case 'convergeOverride':
        // The bar only dispatches this once the human has typed a reason.
        if (reason) converge.mutate({ featureId, overrideReason: reason })
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
      case 'unarchive':
        unarchive.mutate({ featureId })
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
                const n = res.files.length
                toast.push(
                  n > 0
                    ? `merge conflict in ${n} file${n === 1 ? '' : 's'} — resolve below and retry`
                    : 'merge conflict — resolve below and retry',
                )
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
          <button className="ws-branch" title="Copy branch name" onClick={() => copyText(feature.branch, toast)}>
            <IconBranch size={11} />
            {feature.branch}
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

      {offline && (
        <div className="ws-banner is-offline" role="status">
          <span className="ws-banner-tag">OFFLINE</span>
          <span>server unreachable — retrying…</span>
        </div>
      )}

      {resumeFailed.message && (
        <div className="ws-banner" role="alert" onClick={resumeFailed.dismiss} title="dismiss">
          <span className="ws-banner-tag">RESUME FAILED</span>
          <span>{resumeFailed.message}</span>
        </div>
      )}

      <div className="ws-body">
        <div className="ws-body-inner" key={effective}>
          <PhaseBody
            effective={effective}
            full={full}
            driving={driving}
            runId={run?.id ?? null}
            readonly={readonly}
            mapRailCollapsed={mapRailCollapsed}
            onToggleMapRail={onToggleMapRail}
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
  mapRailCollapsed,
  onToggleMapRail,
}: {
  effective: Phase
  full: FeatureFull
  driving: DriveState | null
  runId: string | null
  readonly: boolean
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
}) {
  switch (effective) {
    case 'ideation':
    case 'spec':
      return (
        <GrillBody
          full={full}
          effective={effective}
          mapRailCollapsed={mapRailCollapsed}
          onToggleMapRail={onToggleMapRail}
        />
      )
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
  onAction: (kind: ActionKind, reason?: string) => void
}) {
  // An action carrying a `reason` prompt (Override & converge…) doesn't fire on
  // click: it replaces the buttons with an inline input until the human commits
  // or cancels.
  const [asking, setAsking] = useState<{ kind: ActionKind; prompt: ReasonPrompt } | null>(null)
  const [reason, setReason] = useState('')
  const stopAsking = () => {
    setAsking(null)
    setReason('')
  }
  const click = (a: NextAction) =>
    a.reason ? setAsking({ kind: a.kind, prompt: a.reason }) : onAction(a.kind)

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
        {/* Fog is shown, never enforced — it warns beside the action without
            gating it (ADR-0001 §13.6). */}
        {ns.fog && (
          <div className="nextstep-fog" role="note">
            <span className="nextstep-fog-icon" aria-hidden="true">
              ⚑
            </span>
            <span>Fog remains — still not specified: {ns.fog}. You can converge anyway.</span>
          </div>
        )}
      </div>
      <div className="nextstep-actions">
        {asking ? (
          <div className="nextstep-override">
            <input
              className="override-input"
              placeholder={asking.prompt.placeholder}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="solid"
              className="btn-xs"
              disabled={busy || !reason.trim()}
              onClick={() => {
                onAction(asking.kind, reason.trim())
                stopAsking()
              }}
            >
              {asking.prompt.submitLabel}
            </Button>
            <Button variant="ghost" className="btn-xs" onClick={stopAsking}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            {ns.secondary.map((a, i) => (
              <Button
                key={i}
                variant="ghost"
                className="btn-xs"
                disabled={busy}
                onClick={() => click(a)}
              >
                {a.label}
              </Button>
            ))}
            {ns.primary && (
              <Button
                variant={ns.primary.danger ? 'danger' : 'solid'}
                disabled={busy}
                onClick={() => click(ns.primary!)}
              >
                {busy ? 'Working…' : ns.primary.label}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Surface `session.resume_failed` events prominently (a Resume attempt died
 * before going live — previously just a silent flicker-and-relabel). Watches
 * the feature's event log and raises a banner for ~8s on each NEW failure;
 * history replayed on mount is skipped so stale failures don't re-alert. The
 * event also stays in the inspector's activity feed permanently.
 */
function useResumeFailedAlert(featureId: string): { message: string | null; dismiss: () => void } {
  const events = useEventLog(featureId)
  const [message, setMessage] = useState<string | null>(null)
  // null until the first batch lands — everything in that batch is history.
  const lastSeenRef = useRef<number | null>(null)

  useEffect(() => {
    if (events.length === 0) return
    const maxId = events[events.length - 1].id
    if (lastSeenRef.current === null) {
      lastSeenRef.current = maxId
      return
    }
    const cutoff = lastSeenRef.current
    lastSeenRef.current = maxId
    const failed = events.filter(
      (e: EventRow) => e.id > cutoff && e.type === 'session.resume_failed',
    )
    const last = failed[failed.length - 1]
    if (last) setMessage(last.message || 'session resume failed — relaunch to continue')
  }, [events])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 8000)
    return () => clearTimeout(t)
  }, [message])

  return { message, dismiss: () => setMessage(null) }
}

function copyText(text: string, toast: { push: (m: string, k?: 'error' | 'info' | 'success') => void }): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.push(`copied ${text}`, 'info'))
    .catch(() => toast.push('copy failed'))
}
