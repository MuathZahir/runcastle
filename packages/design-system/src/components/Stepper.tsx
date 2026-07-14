export interface Step {
  /** Step label. */
  label: string
  /** Progress state; drives the colour and the marker treatment. */
  state?: 'todo' | 'done' | 'current' | 'skipped'
}

export interface StepperProps {
  /** Ordered steps, top to bottom. */
  steps: Step[]
}

/**
 * A vertical progress stepper for a linear lifecycle. Done steps read solid,
 * the `current` step gets a violet halo, `skipped` steps strike through, and
 * `todo` steps stay dim. Purely presentational — drive it from your own state.
 */
export function Stepper({ steps }: StepperProps) {
  return (
    <div className="stepper">
      {steps.map((step, i) => (
        <div key={i} className={`step step-${step.state ?? 'todo'}`}>
          <span className="step-mark" />
          <span className="step-label">{step.label}</span>
        </div>
      ))}
    </div>
  )
}
