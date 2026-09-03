import { useState } from 'react'
import { AFK_BURN_EXPLAINER } from '../../lib/vocabulary'
import { Button } from '../../ui'
import { EnableAfkCard } from '../EnableAfkCard'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The one optional step, so it is asked as a question rather than laid out as a
 * form (decision 4). It used to open on the whole Enable-AFK card — Docker, the
 * sandcastle image, an OAuth token — under the heading "ENABLE AFK BURNS", three
 * unexplained letters at the first thing a new user is asked to set up
 * (findings F13/F16), with two buttons that both meant continue.
 *
 * Now it is a heading, one explainer line, and two answers. `Set up now` reveals
 * the card in place and takes both buttons away with it: the card's own
 * `Set up later` is then the step's single continue affordance, which is what
 * stops the pair from reappearing.
 *
 * The card itself is untouched — it belongs to Settings, which renders the same
 * component with `onDismiss` omitted.
 */
export function AfkStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [settingUp, setSettingUp] = useState(false)

  return (
    <>
      <StepHeading title="Run burns unattended?">{AFK_BURN_EXPLAINER}</StepHeading>

      <StepActions onBack={onBack}>
        {!settingUp && (
          <>
            <Button variant="ghost" onClick={() => setSettingUp(true)}>
              Set up now
            </Button>
            <Button variant="solid" onClick={onNext}>
              Skip for now
            </Button>
          </>
        )}
      </StepActions>

      {settingUp && (
        <div className="mt-6">
          <EnableAfkCard onDismiss={onNext} />
        </div>
      )}
    </>
  )
}
