import { Fragment } from 'react'
import type { Phase } from '@runcastle/core'
import type { PipelineStep } from '../../lib/feature-ui'
import { lapExplainer } from '../../lib/vocabulary'

export function PipelineStepper({
  steps,
  lap,
  onView,
}: {
  steps: PipelineStep[]
  lap: number
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
      {/* A feature merged on lap 1 looks exactly like the old linear flow
          (ADR-0010 §4) — the chip only appears once Iterate has looped. */}
      {lap > 1 && (
        <span className="pipeline-lap" title={lapExplainer(lap)}>
          Lap {lap}
        </span>
      )}
    </div>
  )
}
