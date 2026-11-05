import { useState } from 'react'
import { IconArrowRight, IconFlame } from '../../icons'
import { Button } from '../../ui'
import { EnableAfkCard } from '../EnableAfkCard'
import { Term } from '../Term'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The one optional step, so it is asked as a question rather than laid out as a
 * form (decision 4). It used to open on the whole Enable-AFK card — Docker, the
 * sandcastle image, an OAuth token — under the heading "ENABLE AFK BURNS", three
 * unexplained letters at the first thing a new user is asked to set up
 * (findings F13/F16), with two buttons that both meant continue.
 *
 * Now it is a heading, one explainer line, and two answers. `Set up now` reveals
 * the checklist in place and takes both buttons away with it: the checklist's
 * own `Set up later` is then the step's single continue affordance, which is
 * what stops the pair from reappearing.
 *
 * The checklist itself belongs to Settings, which renders the same component
 * with `onDismiss` omitted.
 */
export function AfkStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [settingUp, setSettingUp] = useState(false)

  return (
    <>
      <StepHeading title="Run workers unattended?">
        {/* The step's word carries its glossary hint (ready-to-publish decision 17). */}
        <Term id="worker">Workers</Term> run a round’s tickets in containers, unattended, and you read the result
        when you are back. You can skip it for now, but you need it before your first round can build anything.
      </StepHeading>

      {settingUp && (
        <div className="mt-8 animate-rise-in">
          <EnableAfkCard onDismiss={onNext} />
        </div>
      )}

      <StepActions onBack={onBack}>
        {!settingUp && (
          <>
            <Button variant="ghost" icon={<IconFlame />} onClick={() => setSettingUp(true)}>
              Set up now
            </Button>
            <Button variant="primary" icon={<IconArrowRight />} onClick={onNext}>
              Skip for now
            </Button>
          </>
        )}
      </StepActions>
    </>
  )
}
