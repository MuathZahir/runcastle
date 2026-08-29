import type { StepState, WizardStepRow } from '../../lib/first-run'
import { IconCheck } from '../../icons'

/**
 * The step rail, shown from the first setup step on (decision 4) — never on the
 * intro, which is one screen about the product rather than a step of setup.
 *
 * Beneath it sit the passed rows: a step the host satisfied before the user
 * arrived keeps its place on the rail AND says what was found, because a step
 * that was quietly crossed off reads as one that was never checked (finding
 * F13).
 *
 * Both maps are whole literal classes rather than interpolated names, so
 * Tailwind's scanner can see them (apps/web/STYLE.md).
 */
const STEP_TEXT: Record<StepState, string> = {
  passed: 'text-ok',
  done: 'text-text-2',
  current: 'text-accent-hi',
  todo: 'text-text-4',
}

/** Drawn for every state but `passed`, which wears a checkmark instead. */
const STEP_DOT: Record<StepState, string> = {
  passed: 'bg-ok',
  done: 'bg-text-3',
  current: 'bg-accent',
  todo: 'bg-hairline',
}

export function WizardRail({ steps }: { steps: WizardStepRow[] }) {
  const passed = steps.filter((s) => s.state === 'passed')
  return (
    <>
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label="Setup progress">
        {steps.map((s) => (
          <li key={s.key} className={`flex items-center gap-1.5 ${STEP_TEXT[s.state]}`} title={s.detected}>
            {s.state === 'passed' ? (
              <IconCheck size={11} />
            ) : (
              <span className={`size-[7px] rounded-pill ${STEP_DOT[s.state]}`} aria-hidden />
            )}
            {s.label}
          </li>
        ))}
      </ol>
      {passed.map((s) => (
        <div key={s.key} className="mt-2 flex items-center gap-1.5 text-sm text-text-3">
          <span className="flex-none text-ok">
            <IconCheck size={12} />
          </span>
          <span>
            {s.label} — {s.detected}
          </span>
        </div>
      ))}
    </>
  )
}
