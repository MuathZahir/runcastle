import { Fragment } from 'react'
import type { Phase } from '@runcastle/core'
import type { PipelineStep } from '../../lib/feature-ui'
import { PHASE_NAME, PhaseIcon } from '../../icons'
import { cx } from '../../ui'

/**
 * The glyph a step wears. One `PhaseIcon` per step whose `phase` prop changes
 * with the step's state, so an advance is SEEN: the mounted glyph sweeps its
 * fill from the dashed ring to its own fraction, and from there to the check.
 *
 * - done — the shipped check, in its own (success) hue.
 * - current — the step's own glyph in `text` (shipped keeps its check hue:
 *   a finished pipeline is all checks).
 * - upcoming — the dashed ring, in `text-tertiary`.
 */
function StepGlyph({ step }: { step: PipelineStep }) {
  if (step.state === 'done') return <PhaseIcon phase="shipped" size={14} label="" />
  if (step.state === 'current')
    return (
      <PhaseIcon
        phase={step.phase}
        size={14}
        label=""
        className={step.phase === 'shipped' ? undefined : 'text-text'}
      />
    )
  return <PhaseIcon phase="draft" size={14} label="" className="text-text-tertiary" />
}

const STEP_TEXT: Record<PipelineStep['state'], string> = {
  done: 'text-text-secondary',
  current: 'font-medium text-text',
  upcoming: 'text-text-tertiary',
}

/**
 * The feature's pipeline as a compact inline stepper under the title
 * (DESIGN.md §PhaseStepper): 24px steps, 12px hairline separators. A past step
 * is a button that pins it read-only; the step being viewed in that pin takes
 * `surface-selected` — the stepper itself says what you are looking at, so no
 * badge or band repeats it.
 *
 * The row is pulled left by one step's padding so the first glyph starts on
 * the title's left edge; it wraps rather than overflowing a narrow column.
 */
export function PipelineStepper({
  steps,
  onView,
  readonly = false,
}: {
  steps: PipelineStep[]
  onView: (phase: Phase) => void
  /** An earlier step is pinned: its `isViewed` step takes the selected fill. */
  readonly?: boolean
}) {
  return (
    <nav aria-label="Pipeline" className="-ml-2 flex flex-wrap items-center gap-x-0.5 gap-y-1">
      {steps.map((s, i) => {
        const pinned = readonly && s.isViewed
        return (
          <Fragment key={s.phase}>
            <button
              type="button"
              className={cx(
                'inline-flex h-(--control-sm) shrink-0 items-center gap-1.5 rounded-md px-2 text-xs',
                'transition-colors duration-(--dur-1) ease-app',
                STEP_TEXT[s.state],
                pinned && 'bg-surface-selected text-text',
                s.clickable && !pinned
                  ? 'cursor-pointer hover:bg-surface-hover hover:text-text'
                  : s.clickable
                    ? 'cursor-pointer'
                    : 'cursor-default',
              )}
              title={s.tip}
              aria-current={s.state === 'current' ? 'step' : undefined}
              aria-pressed={s.clickable ? pinned : undefined}
              disabled={!s.clickable}
              onClick={() => s.clickable && onView(s.phase)}
            >
              <StepGlyph step={s} />
              <span>{PHASE_NAME[s.phase]}</span>
            </button>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="mx-0.5 h-px w-3 shrink-0 bg-border-strong" />
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
