import { useState } from 'react'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { useEventLog } from '../../lib/events'
import { PHASE_ORDER, primaryAction, stateSummary } from '../../lib/feature-ui'
import type { DriveState, Tab } from '../../lib/tabs'
import { relTime } from '../../lib/format'
import { Button, DimLine, PhaseTag } from '../../ui'
import { DocPeek } from '../DocPeek'

/**
 * Overview tab (UI-SPEC §3) — NOT a dashboard. A single centred column: phase
 * word + one-line state summary, THE primary action as the only solid button
 * (state machine), ghost secondary actions, then the last 8 timeline events.
 */
export function OverviewTab({
  featureId,
  driving,
  onOpenTab,
  onDriveChange,
}: {
  featureId: string
  driving: DriveState | null
  onOpenTab: (tab: Tab) => void
  onDriveChange: (d: DriveState | null) => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const events = useEventLog(featureId)
  const [peek, setPeek] = useState<{ relPath: string; title: string } | null>(null)

  const invalidate = () => {
    utils.feature.get.invalidate({ id: featureId })
    utils.feature.list.invalidate()
  }

  const launch = trpc.feature.launchSession.useMutation({
    onSuccess: ({ sessionId }) => {
      invalidate()
      onOpenTab({ kind: 'terminal', featureId, sessionId })
    },
    onError: (e) => toast.push(e.message),
  })
  const testDrive = trpc.feature.testDrive.useMutation({
    onSuccess: (res) => {
      invalidate()
      if (res.ok && res.branch) {
        onDriveChange({ featureId, branch: res.branch })
      } else if (!res.ok) {
        toast.push(res.deniedReason ?? 'test drive denied')
      }
    },
    onError: (e) => toast.push(e.message),
  })
  const merge = trpc.feature.merge.useMutation({
    onSuccess: (res) => {
      invalidate()
      if (res.ok) toast.push('merged — feature shipped', 'success')
      else toast.push('merge conflict — resolve and retry')
    },
    onError: (e) => toast.push(e.message),
  })
  const burn = trpc.feature.burn.useMutation({
    onSuccess: ({ runId }) => {
      invalidate()
      onOpenTab({ kind: 'run', featureId, runId })
    },
    onError: (e) => toast.push(e.message),
  })

  const busy = launch.isPending || testDrive.isPending || merge.isPending || burn.isPending

  if (full.isLoading) {
    return (
      <div className="overview">
        <div className="overview-col">
          <DimLine>loading feature…</DimLine>
        </div>
      </div>
    )
  }
  if (full.error || !full.data) {
    return (
      <div className="overview">
        <div className="overview-col">
          <DimLine>could not load feature: {full.error?.message ?? 'unknown'}</DimLine>
        </div>
      </div>
    )
  }

  const data = full.data
  const isDriving = driving?.featureId === featureId
  const action = primaryAction(data, isDriving)
  const summary = stateSummary(data, isDriving)
  const latestSession = [...data.sessions].reverse()[0]
  const lastEvents = events.slice(-8).reverse()

  const runPrimary = () => {
    switch (action.kind) {
      case 'startGrill':
        launch.mutate({ featureId, kind: 'ideation' })
        break
      case 'openGrill':
        if (action.sessionId)
          onOpenTab({ kind: 'terminal', featureId, sessionId: action.sessionId })
        break
      case 'reviewTickets':
        onOpenTab({ kind: 'tickets', featureId })
        break
      case 'startBurn':
        burn.mutate({ featureId })
        break
      case 'watchRun':
        if (action.runId) onOpenTab({ kind: 'run', featureId, runId: action.runId })
        else toast.push('no run to watch yet')
        break
      case 'testDrive':
        testDrive.mutate({ featureId, action: 'start' })
        break
      case 'merge':
        merge.mutate({ featureId })
        break
      case 'askQuestions':
        launch.mutate({ featureId, kind: 'qa' })
        break
    }
  }

  return (
    <div className="overview">
      <div className="overview-col">
        <div className="overview-phase">
          <PhaseTag phase={data.feature.phase} />
          <span className="overview-title">{data.feature.title}</span>
        </div>
        <p className="overview-summary">{summary}</p>

        <Button variant="solid" className="overview-primary" onClick={runPrimary} disabled={busy}>
          {busy ? 'Working…' : action.label}
        </Button>

        <div className="overview-secondary">
          {latestSession && action.kind !== 'openGrill' && (
            <button
              className="ghost-link"
              onClick={() =>
                onOpenTab({ kind: 'terminal', featureId, sessionId: latestSession.id })
              }
            >
              Open terminal
            </button>
          )}
          {PHASE_ORDER.indexOf(data.feature.phase) >= PHASE_ORDER.indexOf('tickets') && (
            <button className="ghost-link" onClick={() => onOpenTab({ kind: 'tickets', featureId })}>
              Tickets
            </button>
          )}
          {data.feature.phase !== 'shipped' && data.feature.status !== 'shipped' && (
            <button
              className="ghost-link"
              onClick={() => launch.mutate({ featureId, kind: 'qa' })}
              disabled={busy}
            >
              Open Q&amp;A
            </button>
          )}
          {data.docs.length > 0 && (
            <button
              className="ghost-link"
              onClick={() =>
                setPeek({ relPath: data.docs[0].relPath, title: data.docs[0].title })
              }
            >
              Open docs
            </button>
          )}
        </div>

        <div className="overview-timeline">
          <div className="section-title">Recent</div>
          {lastEvents.length === 0 && <DimLine>no activity yet</DimLine>}
          {lastEvents.map((e) => (
            <div key={e.id} className="tl-line mono">
              <span className="tl-time">{relTime(e.ts)}</span>
              <span className="tl-type">{e.type}</span>
              <span className="tl-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>

      {peek && (
        <DocPeek
          featureId={featureId}
          relPath={peek.relPath}
          title={peek.title}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  )
}
