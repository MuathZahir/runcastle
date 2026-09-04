import { PHASE_LABELS, PHASE_ORDER } from '../../lib/feature-ui'
import { Button } from '../../ui'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The screen that was missing: what this app is, before the first setting
 * (finding F13). Names the pipeline from the same labels the workspace rail
 * uses, so the phases the user is about to see are the phases they just read
 * about.
 *
 * The one screen with no Back and no rail — there is nothing behind it, and
 * setup has not started.
 */
export function IntroStep({ onNext }: { onNext: () => void }) {
  const pipeline = PHASE_ORDER.map((p) => PHASE_LABELS[p]).join(' → ')
  return (
    <>
      <StepHeading title="Your coding agent, driven through a pipeline">
        Describe a feature and runcastle runs the agent sessions that carry it from idea to merged —{' '}
        <span className="font-mono text-text">{pipeline}</span> — keeping the decisions, spec,
        tickets and commits together on the feature's own branch.
      </StepHeading>
      <p className="mt-3 text-base text-text-2">
        You are the one who says go. runcastle stops at gates and waits for you there:{' '}
        <b className="font-semibold text-text">Burn</b> to turn the tickets you have read into
        commits, <b className="font-semibold text-text">Merge</b> once you have taken the branch for
        a test drive.
      </p>
      <StepActions>
        <Button variant="solid" onClick={onNext} autoFocus>
          Set up runcastle →
        </Button>
      </StepActions>
    </>
  )
}
