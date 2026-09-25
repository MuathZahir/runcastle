import type { StepState, WizardStepRow } from '../../lib/first-run'
import { LogoMark, PhaseIcon } from '../../icons'
import type { PhaseIconPhase } from '../../icons'
import { cx } from '../../ui'

/**
 * The step rail, shown from the first setup step on (decision 4) — never on the
 * intro, which is one screen about the product rather than a step of setup.
 *
 * A slim vertical list in the manner of a `NavItem` column: each step a 32px
 * row with a progress glyph borrowed from the phase shapes — a filled check for
 * a step behind you, the ring-and-dot for the one you are on, a dashed ring for
 * what is ahead. The current row wears `surface-selected`, nothing else.
 *
 * A step the host satisfied before the user arrived keeps its place AND says
 * what was found, beneath its label, because a step that was quietly crossed
 * off reads as one that was never checked (finding F13).
 *
 * Every map is whole literal classes rather than interpolated names, so
 * Tailwind's scanner can see them (apps/web/STYLE.md).
 */
const STEP_GLYPH: Record<StepState, PhaseIconPhase> = {
  passed: 'shipped',
  done: 'shipped',
  current: 'review',
  todo: 'draft',
}

const STEP_TEXT: Record<StepState, string> = {
  passed: 'text-text-secondary',
  done: 'text-text-secondary',
  current: 'bg-surface-selected font-medium text-text',
  todo: 'text-text-tertiary',
}

export function WizardRail({ steps }: { steps: WizardStepRow[] }) {
  return (
    <nav aria-label="Setup" className="flex flex-col gap-4">
      <div className="flex items-center gap-2 px-2.5 text-sm font-medium text-text">
        <LogoMark size={16} />
        Set up runcastle
      </div>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Setup progress">
        {steps.map((s) => (
          <li
            key={s.key}
            data-state={s.state}
            aria-current={s.state === 'current' ? 'step' : undefined}
            className={cx(
              'flex flex-col rounded-md px-2.5 py-1.5 text-sm transition-colors duration-(--dur-2) ease-app',
              STEP_TEXT[s.state],
            )}
          >
            <span className="flex min-h-5 items-center gap-2">
              <PhaseIcon phase={STEP_GLYPH[s.state]} size={14} label="" />
              {s.label}
            </span>
            {s.detected && (
              <span className="mt-0.5 pl-5.5 text-xs font-normal text-pretty text-text-tertiary">
                {s.detected}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
