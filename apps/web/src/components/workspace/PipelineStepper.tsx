import { Fragment } from 'react'
import type { Phase } from '@runcastle/core'
import type { PipelineStep } from '../../lib/feature-ui'
import { lapExplainer } from '../../lib/vocabulary'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** The step's own colour and weight — what it says about where the work is. */
const STEP_STATE: Record<PipelineStep['state'], string> = {
  done: 'text-text-2',
  current: 'font-semibold text-text',
  upcoming: 'text-text-4',
}

/** The dot, which is the part that carries "current" loudest. */
const DOT_STATE: Record<PipelineStep['state'], string> = {
  done: 'opacity-100',
  current:
    'bg-accent opacity-100 shadow-[0_0_0_3px_rgba(124,108,246,0.2)] animate-[dotGlow_2.4s_ease-in-out_infinite]',
  upcoming: 'opacity-50',
}

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
    <div className="mt-4 flex items-center">
      {steps.map((s, i) => (
        <Fragment key={s.phase}>
          <button
            className={cx(
              'inline-flex h-6.5 items-center gap-1.5 rounded-pill border border-transparent px-2.5 text-sm lowercase',
              'transition-[background-color,color,border-color] duration-(--dur-1)',
              STEP_STATE[s.state],
              s.isViewed && 'border-hairline bg-panel',
              s.isViewed && s.state === 'current' && 'border-accent-line',
              s.clickable
                ? 'cursor-pointer hover:bg-panel hover:text-text active:scale-[0.97]'
                : 'cursor-default',
            )}
            title={s.tip}
            disabled={!s.clickable}
            onClick={() => s.clickable && onView(s.phase)}
          >
            <span
              className={cx(
                'size-2 shrink-0 rounded-pill bg-current transition-[opacity,box-shadow] duration-(--dur-2)',
                DOT_STATE[s.state],
              )}
            />
            <span>{s.label}</span>
          </button>
          {i < steps.length - 1 && (
            <span
              className={`h-px w-4 shrink-0 transition-colors duration-(--dur-2) ${s.state === 'done' ? 'bg-text-4' : 'bg-hairline'}`}
            />
          )}
        </Fragment>
      ))}
      {/* A feature merged on lap 1 looks exactly like the old linear flow
          (ADR-0010 §4) — the chip only appears once Iterate has looped. */}
      {lap > 1 && (
        <span
          className="ml-3 shrink-0 rounded-sm border border-hairline px-1.5 py-px font-mono text-[10px] tracking-wider text-text-3"
          title={lapExplainer(lap)}
        >
          Lap {lap}
        </span>
      )}
    </div>
  )
}
