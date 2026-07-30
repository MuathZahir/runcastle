/**
 * First-run wizard sequencing (finding F13).
 *
 * Two decisions the wizard card should not make inline: where setup begins, and
 * how a step the host already satisfies is shown. Starting silently on step 2
 * reads as a step that was never checked — so an auto-satisfied step keeps its
 * row, wears a checkmark, and carries what was detected.
 */

/** The setup steps, in order. The intro screen sits before all of them. */
export type SetupStep = 'identity' | 'afk' | 'project'

/** Every screen the wizard can show — the intro is not a setup step. */
export type WizardScreen = 'intro' | SetupStep

/** The shape of a doctor probe result, structurally (keeps this module IO-free). */
export interface ProbeLike {
  status: string
  detail: string
}

/**
 * `passed` is the honest state for a step the host satisfied before the user
 * arrived; `done` is one they walked through themselves.
 */
export type StepState = 'passed' | 'done' | 'current' | 'todo'

export interface WizardStepRow {
  key: SetupStep
  label: string
  state: StepState
  /** What was already in place — set on `passed` rows only. */
  detected?: string
}

const SETUP_ORDER: { key: SetupStep; label: string }[] = [
  { key: 'identity', label: 'Git identity' },
  { key: 'afk', label: 'AFK burns' },
  { key: 'project', label: 'First project' },
]

/** Setup opens on the first step the host has not already satisfied for us. */
export function firstSetupStep(identity: ProbeLike | undefined): SetupStep {
  return identity?.status === 'ok' ? 'afk' : 'identity'
}

/**
 * What the git-identity probe found, phrased for a human. An unset probe's detail
 * is a complaint ("commits would fail"), not a value — so it detected nothing.
 */
function detectedIdentity(identity: ProbeLike | undefined): string | undefined {
  return identity?.status === 'ok' ? `detected from git config: ${identity.detail}` : undefined
}

/**
 * The stepper rows for the screen being shown. Git identity is the only step the
 * host can satisfy on its own, so it is the only one that can come out `passed`.
 */
export function wizardSteps(current: SetupStep, identity: ProbeLike | undefined): WizardStepRow[] {
  const idx = SETUP_ORDER.findIndex((s) => s.key === current)
  const detected = detectedIdentity(identity)
  return SETUP_ORDER.map((s, i) => {
    if (s.key === 'identity' && i < idx && detected)
      return { ...s, state: 'passed' as StepState, detected }
    return { ...s, state: i < idx ? 'done' : i === idx ? 'current' : 'todo' }
  })
}
